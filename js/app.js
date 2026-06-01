// ============ FIRESTORE STRUCTURE ============
// locations/{locationId}
//   - id: string
//   - name: string
//   - note: string
//   - createdAt: timestamp
//   - lastUpdateBy: string
//   - lastUpdateAt: timestamp
//   products/{productId}
//     - name, category, location, quantity, unit, expiryDate, notes, perishable, barcode, createdAt
// shoppingList/{itemId}
//   - name: string
//   - completed: boolean
//   - inCart: boolean
//   - createdAt: timestamp
// locations/{locationId}/notes/{noteId}
// settings/global
//   - expiryDays: number
//   - userName: string

class MiDespensa {
    constructor() {
        this.products = [];
        this.shoppingList = [];
        this.locations = [];
        this.locationNotes = []; // Array to hold notes for the current location
        this.currentLocationId = null;
        this.offSearchResults = []; // Resultados de la búsqueda en internet
        this.settings = {
            expiryDays: 2,
            userName: '',
        };
        this.currentProduct = null;
        this.barcodeStream = null;
        this.scanning = false;
        this.notesUnsubscribe = null; // To store the unsubscribe function for notes listener
        this.firestoreEnabled = false;
        this.currentInventoryFilterType = 'all';
        this.currentInventoryFilterValue = null;
        this.shoppingSearch = '';
        this.hideCatalog = false;
        this.db = null;
        this.hasInteracted = false;
        this.init();
    }

    async init() {
        await this.initFirestore();
        this.setupEventListeners();
        this.render();
        
        document.addEventListener('click', () => {
            this.hasInteracted = true;
        }, { once: true });
    }

    initFirestore() {
        return new Promise((resolve) => {
            if (typeof FIREBASE_ENABLED === 'undefined' || !FIREBASE_ENABLED) {
                this.firestoreEnabled = false;
                resolve();
                return;
            }

            try {
                if (!firebase.apps.length) {
                    firebase.initializeApp(FIREBASE_CONFIG);
                }
                this.db = firebase.firestore();
                this.firestoreEnabled = true;
                this.renderFirestoreStatus();
                this.loadAllData();
                resolve();
            } catch (error) {
                console.warn('Firestore initialization failed:', error);
                this.firestoreEnabled = false;
                this.renderFirestoreStatus('Firestore no disponible');
                resolve();
            }
        });
    }

    loadAllData() {
        if (!this.firestoreEnabled || !this.db) return;

        // Cargar locations en tiempo real
        this.db.collection('locations')
            .orderBy('createdAt', 'desc')
            .onSnapshot(
                (snapshot) => {
                    this.locations = [];
                    snapshot.forEach(doc => {
                        const location = { id: doc.id, ...doc.data() };
                        this.locations.push(location);
                        this.loadProductsForLocation(location.id);
                    });

                    if (this.locations.length > 0 && !this.currentLocationId) {
                        this.currentLocationId = this.locations[0].id;
                        this.updateLocationDisplay();
                        this.setupNotesListener(this.currentLocationId); // Setup notes listener for initial location
                    }

                    this.render();
                },
                (error) => {
                    console.warn('Error cargando locations:', error);
                }
            );

        // Cargar shopping list en tiempo real
        this.db.collection('shoppingList')
            .orderBy('createdAt', 'asc')
            .onSnapshot(
                (snapshot) => {
                    this.shoppingList = [];
                    snapshot.forEach(doc => {
                        this.shoppingList.push({ id: doc.id, ...doc.data() });
                    });
                    this.render();
                },
                (error) => {
                    console.warn('Error cargando shopping list:', error);
                }
            );

        // Cargar settings
        this.db.collection('settings').doc('global')
            .onSnapshot(
                (doc) => {
                    if (doc.exists) {
                        const data = doc.data();
                        this.settings = { ...this.settings, ...data };
                        if (data.currentLocationId) {
                            this.currentLocationId = data.currentLocationId;
                        }
                        this.setupNotesListener(this.currentLocationId); // Ensure notes listener is for the correct location
                        if (document.getElementById('expiryDays')) {
                            document.getElementById('expiryDays').value = this.settings.expiryDays;
                        }
                        if (document.getElementById('userName')) {
                            document.getElementById('userName').value = this.settings.userName || '';
                        }
                        this.updateLocationDisplay();
                        this.render();
                    }
                },
                (error) => {
                    console.warn('Error cargando settings:', error);
                }
            );
    }

    loadProductsForLocation(locationId) {
        if (!this.firestoreEnabled || !this.db) return;

        this.db.collection('locations').doc(locationId).collection('products')
            .orderBy('createdAt', 'desc')
            .onSnapshot(
                (snapshot) => {
                    const products = [];
                    snapshot.forEach(doc => {
                        products.push({
                            firebaseId: doc.id,
                            locationId: locationId,
                            ...doc.data()
                        });
                    });
                    
                    this.products = this.products.filter(p => p.locationId !== locationId);
                    this.products.push(...products);
                    this.render();
                },
                (error) => {
                    console.warn(`Error cargando productos para ${locationId}:`, error);
                }
            );
    }

    setupNotesListener(locationId) {
        if (this.notesUnsubscribe) {
            this.notesUnsubscribe(); // Unsubscribe from previous listener
        }
        if (!this.firestoreEnabled || !this.db || !locationId) {
            this.locationNotes = []; // Clear notes if no valid location
            this.render();
            return;
        }

        this.notesUnsubscribe = this.db.collection('locations').doc(locationId).collection('notes')
            .orderBy('createdAt', 'desc')
            .onSnapshot(
                (snapshot) => {
                    this.locationNotes = []; // Clear existing notes
                    snapshot.forEach(doc => {
                        this.locationNotes.push({
                            id: doc.id,
                            locationId: locationId,
                            ...doc.data()
                        });
                    });
                    this.render(); // Re-render to show updated notes
                },
                (error) => {
                    console.warn(`Error cargando notas para ${locationId}:`, error);
                    this.locationNotes = []; // Clear notes on error
                    this.render();
                });
    }

    // ============ SPEECH FUNCTIONS ============
    speak(text, onEndCallback = null) {
        if (!('speechSynthesis' in window)) return;
        
        // Cancelar cualquier discurso previo
        window.speechSynthesis.cancel();
        
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'es-ES';
        utterance.rate = 1;
        
        utterance.onstart = () => {
            document.querySelectorAll('.stop-voice-btn').forEach(btn => btn.style.display = 'inline-block');
        };

        const cleanup = () => {
            document.querySelectorAll('.stop-voice-btn').forEach(btn => btn.style.display = 'none');
            if (onEndCallback) onEndCallback();
        };

        utterance.onend = cleanup;
        utterance.onerror = cleanup;
        
        window.speechSynthesis.speak(utterance);
    }

    stopSpeaking() {
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            document.querySelectorAll('.stop-voice-btn').forEach(btn => btn.style.display = 'none');
        }
    }

    readAllNotesAloud() {
        if (this.locationNotes.length === 0) {
            this.speak("No hay notas para esta vivienda.");
            return;
        }
        const notesText = this.locationNotes.map(n => n.text).join('. ');
        this.speak(`Avisos de ${this.getCurrentLocation()?.name || 'la vivienda'}: ${notesText}`);
    }

    readFilteredProductsAloud() {
        const search = document.getElementById('searchInput')?.value || '';
        const filtered = this.filterProducts(search, this.currentInventoryFilterType, this.currentInventoryFilterValue);
        
        if (filtered.length === 0) {
            this.speak("No hay productos que mostrar.");
            return;
        }

        const productsText = filtered.map(p => {
            let pText = `${p.name}, ${p.quantity}.`;
            const status = this.getExpiryStatus(p);
            if (status === 'expired') pText += " Está caducado.";
            return pText;
        }).join(' ');

        this.speak(`Lista de productos: ${productsText}`);
    }

    // ============ PRODUCTS ============
    async addProduct(data) {
        if (!this.firestoreEnabled || !this.db || !this.currentLocationId) return;

        const product = {
            name: data.name,
            category: data.category,
            location: data.location,
            quantity: parseFloat(data.quantity) || 1,
            unit: data.unit,
            expiryDate: data.expiryDate || null,
            notes: data.notes,
            perishable: data.perishable,
            barcode: data.barcode || '',
            createdAt: new Date(),
        };

        try {
            await this.db.collection('locations')
                .doc(this.currentLocationId)
                .collection('products')
                .add(product);
            this.updateLocationTimestamp();
        } catch (error) {
            console.error('Error al añadir producto:', error);
            alert('Error al guardar el producto');
        }
    }

    async updateProduct(firebaseId, data) {
        if (!this.firestoreEnabled || !this.db || !this.currentLocationId) return;

        const product = {
            name: data.name,
            category: data.category,
            location: data.location,
            quantity: parseFloat(data.quantity) || 1,
            unit: data.unit,
            expiryDate: data.expiryDate || null,
            notes: data.notes,
            perishable: data.perishable,
            barcode: data.barcode || '',
        };

        try {
            await this.db.collection('locations')
                .doc(this.currentLocationId)
                .collection('products')
                .doc(firebaseId)
                .update(product);
            this.updateLocationTimestamp();
        } catch (error) {
            console.error('Error al actualizar producto:', error);
            alert('Error al guardar el producto');
        }
    }

    async deleteProduct(firebaseId) {
        if (!this.firestoreEnabled || !this.db || !this.currentLocationId) return;

        try {
            await this.db.collection('locations')
                .doc(this.currentLocationId)
                .collection('products')
                .doc(firebaseId)
                .delete();
            this.updateLocationTimestamp();
        } catch (error) {
            console.error('Error al eliminar producto:', error);
            alert('Error al eliminar el producto');
        }
    }

    getProduct(firebaseId) {
        return this.products.find(p => p.firebaseId === firebaseId);
    }

    consumeProduct(firebaseId) {
        this.deleteProduct(firebaseId);
        this.render();
    }

    // ============ LOCATIONS ============
    async addLocation(name) {
        if (!this.firestoreEnabled || !this.db) return;

        const location = {
            name: name,
            note: '',
            createdAt: new Date(),
        };

        try {
            const docRef = await this.db.collection('locations').add(location);
            if (this.locations.length === 0) {
                this.currentLocationId = docRef.id;
                this.updateLocationDisplay();
            }
        } catch (error) {
            console.error('Error al añadir vivienda:', error);
            alert('Error al crear la vivienda');
        }
    }

    async deleteLocation(locationId) {
        if (this.locations.length <= 1) {
            alert('Debes tener al menos una vivienda');
            return false;
        }
        if (this.currentLocationId === locationId) {
            alert('No puedes eliminar la vivienda actual. Selecciona otra primero.');
            return false;
        }

        if (!this.firestoreEnabled || !this.db) return false;

        try {
            const productsSnapshot = await this.db.collection('locations')
                .doc(locationId)
                .collection('products')
                .get();
            
            const batch = this.db.batch();
            productsSnapshot.forEach(doc => {
                batch.delete(doc.ref);
            });
            await batch.commit();

            await this.db.collection('locations').doc(locationId).delete();
            return true;
        } catch (error) {
            console.error('Error al eliminar vivienda:', error);
            alert('Error al eliminar la vivienda');
            return false;
        }
    }

    async setCurrentLocation(id) {
        if (this.locations.find(l => l.id === id)) {
            this.currentLocationId = id;
            this.updateLocationDisplay();
            this.setupNotesListener(this.currentLocationId); // Update notes listener
            this.render();
            this.closeLocationModal();
            await this.saveCurrentLocation();
        }
    }

    getCurrentLocation() {
        return this.locations.find(l => l.id === this.currentLocationId);
    }

    updateLocationDisplay() {
        const location = this.getCurrentLocation();
        if (location) {
            document.getElementById('currentLocation').textContent = location.name;
        }
    }

    async updateLocationTimestamp() {
        if (!this.firestoreEnabled || !this.db || !this.currentLocationId) return;
        if (!this.settings.userName) return;

        try {
            await this.db.collection('locations').doc(this.currentLocationId).update({
                lastUpdateBy: this.settings.userName,
                lastUpdateAt: new Date(),
            });
        } catch (error) {
            console.warn('Error actualizando timestamp:', error);
        }
    }

    async saveCurrentLocation() {
        if (!this.firestoreEnabled || !this.db || !this.currentLocationId) return;

        try {
            await this.db.collection('settings').doc('global').set({
                currentLocationId: this.currentLocationId,
            }, { merge: true });
        } catch (error) {
            console.warn('Error guardando ubicación actual:', error);
        }
    }

    // ============ NOTES ============
    async saveNote() {
        const textInput = document.getElementById('noteText');
        const noteContent = textInput.value.trim();

        if (!noteContent) {
            alert('La nota no puede estar vacía.');
            return;
        }
        if (!this.firestoreEnabled || !this.db || !this.currentLocationId) return;

        const newNote = {
            text: noteContent,
            createdAt: new Date(),
            createdBy: this.settings.userName || 'Anónimo',
        };

        try {
            await this.db.collection('locations').doc(this.currentLocationId).collection('notes').add(newNote);
            textInput.value = ''; // Clear the input after saving
            this.updateLocationTimestamp();
            // render() is called by the onSnapshot listener for notes
        } catch (error) {
            console.error('Error al guardar nota:', error);
            alert('Error al guardar la nota');
        }
    }

    // This now clears the input field for a new note
    async clearNote() {
        const textInput = document.getElementById('noteText');
        if (textInput) {
            textInput.value = '';
        }
        // No need to interact with Firestore here, as it's just clearing the input
    }

    // New function to delete an individual note
    async deleteIndividualNote(noteId) {
        if (!this.firestoreEnabled || !this.db || !this.currentLocationId) return;
        if (!confirm('¿Estás seguro de que quieres borrar esta nota?')) return;

        try {
            await this.db.collection('locations').doc(this.currentLocationId).collection('notes').doc(noteId).delete();
            this.updateLocationTimestamp();
            // render() is called by the onSnapshot listener for notes
        } catch (error) {
            console.error('Error al borrar nota individual:', error);
            alert('Error al borrar la nota.');
        }
    }

    // This now just ensures the input field is clear for a new note
    renderNoteEditor() {
        const text = document.getElementById('noteText');
        if (text) {
            text.value = ''; // Ensure the input field is empty for a new note
        }
    }

    renderNotes() {
        const list = document.getElementById('notesList');
        if (!list) return;

        const currentLocation = this.getCurrentLocation();
        const isSpeaking = window.speechSynthesis.speaking;
        const stopBtnStyle = isSpeaking ? 'inline-block' : 'none';
        if (currentLocation) {
            document.getElementById('notesHeader').innerHTML = `${currentLocation.name} 
                <button class="product-btn" style="color: var(--primary); font-size: 1.1rem; display: inline-block; vertical-align: middle; padding: 0; margin-left: 5px;" onclick="app.readAllNotesAloud()" title="Leer todas las notas"><i class="fas fa-volume-up"></i></button>
                <button class="product-btn stop-voice-btn" style="color: var(--danger); font-size: 1.1rem; display: ${stopBtnStyle}; vertical-align: middle; padding: 0; margin-left: 5px;" onclick="app.stopSpeaking()" title="Detener voz"><i class="fas fa-stop-circle"></i></button>`;
        }

        const currentNotes = this.locationNotes.filter(n => n.locationId === this.currentLocationId);

        if (currentNotes.length === 0) {
            list.innerHTML = '<p class="empty-state">No hay avisos para esta vivienda.</p>';
            return;
        }

        // Sort notes by creation date (newest first)
        currentNotes.sort((a, b) => {
            const getTime = (val) => {
                if (!val) return 0;
                if (typeof val.toDate === 'function') return val.toDate().getTime();
                return new Date(val).getTime() || 0;
            };
            const timeA = getTime(a.createdAt);
            const timeB = getTime(b.createdAt);
            return timeB - timeA;
        });

        list.innerHTML = currentNotes.map(note => `
            <div class="product-item">
                <div class="product-info">
                    <div class="product-name" style="white-space: pre-wrap; font-weight: normal;">${note.text}</div>
                    <div class="product-meta">
                        <small>Creada por ${note.createdBy} el ${this.formatDateFull(note.createdAt)}</small>
                    </div>
                </div>
                <div class="product-actions">
                    <button class="product-btn" onclick="event.stopPropagation(); app.deleteIndividualNote('${note.id}');" title="Borrar nota">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `).join('');
    }

    getDaysUntilExpiry(expiryDate) {
        if (!expiryDate) return null;
        const expiry = (expiryDate && typeof expiryDate.toDate === 'function') ? expiryDate.toDate() : new Date(expiryDate);
        if (isNaN(expiry.getTime())) return null;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        expiry.setHours(0, 0, 0, 0);
        return Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
    }

    isExpiringSoon(product) {
        const days = this.getDaysUntilExpiry(product.expiryDate);
        return days !== null && days <= this.settings.expiryDays && days >= 0;
    }

    isExpired(product) {
        const days = this.getDaysUntilExpiry(product.expiryDate);
        return days !== null && days < 0;
    }

    getExpiryStatus(product) {
        const days = this.getDaysUntilExpiry(product.expiryDate);
        if (!product.expiryDate) return null;
        if (days < 0) return 'expired';
        if (days <= this.settings.expiryDays) return 'expiring';
        return 'ok';
    }

    formatDate(date) {
        if (!date) return '';
        const d = (date && typeof date.toDate === 'function') ? date.toDate() : new Date(date);
        if (isNaN(d.getTime())) return '';
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        return `${day}/${month}`;
    }

    formatDateFull(date) {
        if (!date) return '';
        const d = (date && typeof date.toDate === 'function') ? date.toDate() : new Date(date);
        if (isNaN(d.getTime())) return 'Fecha inválida';
        const options = { weekday: 'short', month: 'short', day: 'numeric' };
        return d.toLocaleDateString('es-ES', options);
    }

    // ============ FILTERING ============
    filterProducts(search = '', filterType = 'all', filterValue = null) {
        let filtered = this.products.filter(p => p.locationId === this.currentLocationId);

        // Apply category filter first if present
        if (filterType === 'category' && filterValue) {
            filtered = filtered.filter(p => p.category === filterValue);
        } else { // If no specific category filter, apply mainFilter
            if (filterType === 'perishable') {
                filtered = filtered.filter(p => p.perishable);
            } else if (filterType === 'fridge') {
                filtered = filtered.filter(p => p.location === 'fridge' || p.location === 'freezer');
            } else if (filterType === 'expired') {
                filtered = filtered.filter(p => this.isExpired(p));
            }
            // 'all' filterType doesn't need explicit filtering here
        }

        // Filter by search term
        if (search) {
            filtered = filtered.filter(p => 
                p.name.toLowerCase().includes(search.toLowerCase())
            );
        }

        return filtered;
    }

    // ============ STATS ============
    getStats() {
        const currentProducts = this.products.filter(p => p.locationId === this.currentLocationId);
        const total = currentProducts.length;
        const expiring = currentProducts.filter(p => this.isExpiringSoon(p)).length;
        const expired = currentProducts.filter(p => this.isExpired(p)).length;

        return { total, expiring, expired };
    }

    getExpiringProducts() {
        return this.products
            .filter(p => p.locationId === this.currentLocationId)
            .filter(p => this.isExpiringSoon(p))
            .sort((a, b) => {
                const daysA = this.getDaysUntilExpiry(a.expiryDate);
                const daysB = this.getDaysUntilExpiry(b.expiryDate);
                return daysA - daysB;
            })
            .slice(0, 5);
    }

    getProductsByCategory() {
        const categories = {
            dairy: { icon: '🥛', name: 'Lácteos', count: 0 },
            beverages: { icon: '🥤', name: 'Bebidas', count: 0 },
            produce: { icon: '🥬', name: 'Frutas/Verduras', count: 0 },
            meat: { icon: '🍗', name: 'Carnes', count: 0 },
            frozen: { icon: '❄️', name: 'Congelados', count: 0 },
            pantry: { icon: '🍞', name: 'Despensa', count: 0 },
            drugstore: { icon: '🧼', name: 'Droguería', count: 0 },
            other: { icon: '📦', name: 'Otros', count: 0 },
        };

        this.products
            .filter(p => p.locationId === this.currentLocationId)
            .forEach(p => {
            if (categories[p.category]) {
                categories[p.category].count++;
            }
        });

        return categories;
    }

    // ============ SHOPPING LIST ============
    async addShoppingItem(name, category = 'pantry', imageUrl = null, notes = '', metadata = {}) {
        if (!name.trim()) return;
        if (!this.firestoreEnabled || !this.db) return;
        if (imageUrl === 'null') imageUrl = null; // Limpiar string "null" accidental

        const item = {
            name: name.trim(),
            category: category,
            completed: false,
            inCart: true,
            imageUrl: imageUrl || null,
            notes: notes || '',
            barcode: metadata.barcode || '',
            metadata: {
                brand: metadata.brand || '',
                weight: metadata.weight || '',
                unit: metadata.unit || ''
            },
            createdAt: new Date(),
        };

        try {
            // Verificar si el item ya existe en el catálogo para no duplicar
            const existing = this.shoppingList.find(i => i.name.toLowerCase() === name.trim().toLowerCase());
            if (existing) {
                // Actualizar el item existente con la nueva información si viene de una búsqueda enriquecida
                const updates = { inCart: true, completed: false };
                if (metadata.barcode && !existing.barcode) updates.barcode = metadata.barcode;
                if (imageUrl && !existing.imageUrl) updates.imageUrl = imageUrl;
                if (metadata.brand || metadata.weight) {
                    updates.metadata = {
                        brand: metadata.brand || (existing.metadata?.brand || ''),
                        weight: metadata.weight || (existing.metadata?.weight || ''),
                        unit: metadata.unit || (existing.metadata?.unit || '')
                    };
                }
                
                await this.db.collection('shoppingList').doc(existing.id).update(updates);
            } else {
                await this.db.collection('shoppingList').add(item);
            }
            this.offSearchResults = []; // Limpiar resultados tras añadir
        } catch (error) {
            console.error('Error al añadir item de compra:', error);
        }
    }

    async toggleInCart(firebaseId, isInCart) {
        if (!this.firestoreEnabled || !this.db) return;
        try {
            await this.db.collection('shoppingList').doc(firebaseId).update({
                inCart: isInCart,
                completed: false // Si entra al carrito, entra como no completado
            });
        } catch (error) {
            console.error('Error al mover item al carrito:', error);
        }
    }

    async toggleShoppingItem(firebaseId) {
        if (!this.firestoreEnabled || !this.db) return;

        const item = this.shoppingList.find(i => i.id === firebaseId);
        if (!item) return;

        try {
            await this.db.collection('shoppingList').doc(firebaseId).update({
                completed: !item.completed,
            });
        } catch (error) {
            console.error('Error al actualizar item:', error);
        }
    }

    async deleteShoppingItem(firebaseId) {
        if (!this.firestoreEnabled || !this.db) return;

        try {
            await this.db.collection('shoppingList').doc(firebaseId).delete();
        } catch (error) {
            console.error('Error al eliminar item:', error);
        }
    }

    async clearShoppingList() {
        if (!this.firestoreEnabled || !this.db) return;
        if (!confirm('¿Quieres desmarcar todos los productos para empezar una nueva compra? (No se borrarán de la lista)')) return;

        try {
            const batch = this.db.batch();
            this.shoppingList.forEach(item => {
                if (item.inCart) {
                    batch.update(this.db.collection('shoppingList').doc(item.id), { completed: false, inCart: false });
                }
            });
            await batch.commit();
        } catch (error) {
            console.error('Error al limpiar lista:', error);
        }
    }

    shareShoppingListViaWhatsApp() {
        if (this.shoppingList.length === 0) return;

        const categoryMeta = {
            dairy: { icon: '🥛', name: 'Lácteos' },
            beverages: { icon: '🥤', name: 'Bebidas' },
            produce: { icon: '🥬', name: 'Frutas/Verduras' },
            meat: { icon: '🍗', name: 'Carnes' },
            frozen: { icon: '❄️', name: 'Congelados' },
            pantry: { icon: '🍞', name: 'Despensa' },
            drugstore: { icon: '🧼', name: 'Droguería' },
            other: { icon: '📦', name: 'Otros' },
        };

        const pending = this.shoppingList.filter(i => !i.completed);
        const completed = this.shoppingList.filter(i => i.inCart && i.completed);
        const toBuy = this.shoppingList.filter(i => i.inCart && !i.completed);

        let text = '🛒 *MI LISTA DE COMPRA*\n\n';

        // Agrupar pendientes por categoría
        const grouped = {};
        toBuy.forEach(item => {
            const cat = item.category || 'other';
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(item);
        });

        Object.keys(categoryMeta).forEach(catKey => {
            if (grouped[catKey] && grouped[catKey].length > 0) {
                text += `*${categoryMeta[catKey].icon} ${categoryMeta[catKey].name.toUpperCase()}*\n`;
                grouped[catKey].forEach(item => {
                    text += `- ${item.name}\n`;
                });
                text += '\n';
            }
        });

        if (completed.length > 0) {
            text += '*✓ COMPLETADOS*\n';
            completed.forEach(item => {
                text += `- ~${item.name}~\n`;
            });
        }

        const encodedText = encodeURIComponent(text.trim());
        window.open(`https://wa.me/?text=${encodedText}`, '_blank');
    }

    // ============ SETUP EVENT LISTENERS ============
    setupEventListeners() {
        // Tab Navigation
        document.querySelectorAll('.nav-tab').forEach(btn => {
            btn.addEventListener('click', (e) => this.switchTab(btn.dataset.tab));
        });

        // Dashboard
        document.getElementById('addProductBtn').addEventListener('click', () => this.showProductModal());

        // Inventory
        document.getElementById('searchInput').addEventListener('input', (e) => {
            const search = e.target.value;
            this.renderInventory(search);
        });

        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const search = document.getElementById('searchInput').value;
                this.currentInventoryFilterType = btn.dataset.filter;
                this.currentInventoryFilterValue = null;
                this.renderInventory(search);
            });
        });

        // Shopping List
        document.getElementById('addShoppingBtn').addEventListener('click', () => this.addNewShoppingItem());
        document.getElementById('newShoppingItem').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addNewShoppingItem();
        });
        document.getElementById('clearShoppingBtn').addEventListener('click', () => this.clearShoppingList());
        document.getElementById('shareWhatsAppBtn').addEventListener('click', () => this.shareShoppingListViaWhatsApp());

        // Product Modal
        document.getElementById('closeModalBtn').addEventListener('click', () => this.closeProductModal());
        document.getElementById('cancelBtn').addEventListener('click', () => this.closeProductModal());
        document.getElementById('deleteProductBtn').addEventListener('click', () => this.deleteCurrentProduct());
        document.getElementById('productForm').addEventListener('submit', (e) => this.handleProductSubmit(e));
        document.getElementById('lookupBarcodeBtn').addEventListener('click', () => this.lookupBarcode());
        document.getElementById('scanBarcodeBtn').addEventListener('click', () => this.openScanModal());
        document.getElementById('closeScanBtn').addEventListener('click', () => this.closeScanModal());
        document.getElementById('cancelScanBtn').addEventListener('click', () => this.closeScanModal());

        // Settings
        document.getElementById('settingsBtn').addEventListener('click', () => this.showSettingsModal());
        document.getElementById('closeSettingsBtn').addEventListener('click', () => this.closeSettingsModal());
        
        // Locations
        document.getElementById('locationBtn').addEventListener('click', () => this.showLocationModal());
        document.getElementById('closeLocationBtn').addEventListener('click', () => this.closeLocationModal());
        document.getElementById('addLocationBtn').addEventListener('click', () => this.addNewLocation());
        document.getElementById('newLocationName').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addNewLocation();
        });
        document.getElementById('saveNoteBtn').addEventListener('click', () => this.saveNote());
        document.getElementById('clearNoteBtn').addEventListener('click', () => this.clearNote());

        document.getElementById('expiryDays').addEventListener('change', (e) => {
            this.settings.expiryDays = parseInt(e.target.value);
            this.saveSettings();
            this.render();
        });
        document.getElementById('userName').addEventListener('change', (e) => {
            this.settings.userName = e.target.value.trim();
            this.saveSettings();
            this.updateLocationTimestamp();
            this.render();
        });

        document.getElementById('exportBtn').addEventListener('click', () => this.exportData());

        // Perishable checkbox toggle expiry date
        document.getElementById('productPerishable').addEventListener('change', (e) => {
            const expiryInput = document.getElementById('productExpiry');
            expiryInput.disabled = !e.target.checked;
            if (!e.target.checked) {
                expiryInput.value = '';
            }
        });
        document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFile').click());
        document.getElementById('importFile').addEventListener('change', (e) => this.importData(e));
        document.getElementById('clearAllBtn').addEventListener('click', () => this.clearAllData());

        // Modal backdrop click
        document.getElementById('productModal').addEventListener('click', (e) => {
            if (e.target.id === 'productModal') this.closeProductModal();
        });
        document.getElementById('settingsModal').addEventListener('click', (e) => {
            if (e.target.id === 'settingsModal') this.closeSettingsModal();
        });
        document.getElementById('locationModal').addEventListener('click', (e) => {
            if (e.target.id === 'locationModal') this.closeLocationModal();
        });
        
        // Image Preview Modal
        document.getElementById('closePreviewBtn').addEventListener('click', () => {
            document.getElementById('imagePreviewModal').classList.remove('active');
        });
        document.getElementById('closePreviewBtnBottom').addEventListener('click', () => {
            document.getElementById('imagePreviewModal').classList.remove('active');
        });
        document.getElementById('imagePreviewModal').addEventListener('click', (e) => {
            if (e.target.id === 'imagePreviewModal') document.getElementById('imagePreviewModal').classList.remove('active');
        });
    }

    // ============ TAB SWITCHING ============
    switchTab(tab) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
        
        document.getElementById(tab).classList.add('active');
        document.querySelector(`[data-tab="${tab}"]`).classList.add('active');

        if (tab === 'shopping') {
            this.renderShoppingList();
        }
        if (tab === 'notes') {
            this.renderNotes();
        }
        if (tab === 'inventory') {
            this.renderInventory('');
        }
        if (tab === 'dashboard') {
            this.renderDashboard();
        }
        if (tab === 'supermarkets') {
            this.renderSupermarkets();
        }
    }

    showImagePreview(name, imageUrl, notes) {
        const modal = document.getElementById('imagePreviewModal');
        document.getElementById('previewName').textContent = name;
        const img = document.getElementById('previewImage');
        if (imageUrl && imageUrl !== 'null' && imageUrl !== '') {
            img.src = imageUrl;
            img.style.display = 'block';
        } else {
            img.style.display = 'none';
        }
        document.getElementById('previewBrand').textContent = notes || 'Sin marca especificada';
        modal.classList.add('active');
    }

    // ============ MODAL MANAGEMENT ============
    showProductModal(product = null) {
        this.currentProduct = product;
        const modal = document.getElementById('productModal');
        const form = document.getElementById('productForm');
        
        if (product) {
            document.getElementById('modalTitle').textContent = 'Editar Producto';
            document.getElementById('productName').value = product.name;
            document.getElementById('productBarcode').value = product.barcode || '';
            document.getElementById('productCategory').value = product.category;
            document.getElementById('productLocation').value = product.location;
            document.getElementById('productQuantity').value = product.quantity;
            document.getElementById('productUnit').value = product.unit;
            document.getElementById('productExpiry').value = product.expiryDate || '';
            document.getElementById('productNotes').value = product.notes || '';
            document.getElementById('productPerishable').checked = product.perishable || false;
            document.getElementById('deleteProductBtn').style.display = 'block';
        } else {
            form.reset();
            document.getElementById('modalTitle').textContent = 'Agregar Producto';
            document.getElementById('productQuantity').value = '1';
            document.getElementById('productCategory').value = 'pantry';
            document.getElementById('productLocation').value = 'pantry';
            document.getElementById('deleteProductBtn').style.display = 'none';
        }

        // Update expiry date enabled state
        const perishableCheckbox = document.getElementById('productPerishable');
        const expiryInput = document.getElementById('productExpiry');
        expiryInput.disabled = !perishableCheckbox.checked;
        document.getElementById('scanStatus').textContent = 'Sitúa el código frente a la cámara. El escaneo se iniciará automáticamente.';

        modal.classList.add('active');
    }

    closeProductModal() {
        document.getElementById('productModal').classList.remove('active');
        this.currentProduct = null;
    }

    openScanModal() {
        const modal = document.getElementById('scanModal');
        modal.classList.add('active');
        this.startBarcodeScanner();
    }

    closeScanModal() {
        document.getElementById('scanModal').classList.remove('active');
        this.stopBarcodeScanner();
    }

    lookupBarcode() {
        const barcode = document.getElementById('productBarcode').value.trim();
        if (!barcode) {
            alert('Introduce un código de barras para buscar.');
            return;
        }
        this.fetchProductInfoByBarcode(barcode);
    }

    startBarcodeScanner() {
        if (this.scanning) return;
        const status = document.getElementById('scanStatus');
        status.textContent = 'Buscando cámara...';

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            status.textContent = 'El navegador no soporta la cámara.';
            return;
        }

        this.scanning = true;
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
            .then(stream => {
                this.barcodeStream = stream;
                const video = document.getElementById('barcodeVideo');
                video.srcObject = stream;
                video.play();
                status.textContent = 'Apunta el código de barras hacia la cámara.';
                requestAnimationFrame(() => this.scanBarcodeFrame());
            })
            .catch(() => {
                status.textContent = 'No se pudo acceder a la cámara.';
                this.scanning = false;
            });
    }

    stopBarcodeScanner() {
        this.scanning = false;
        const video = document.getElementById('barcodeVideo');
        if (video && video.srcObject) {
            const tracks = video.srcObject.getTracks();
            tracks.forEach(track => track.stop());
            video.srcObject = null;
        }
        if (this.barcodeStream) {
            this.barcodeStream.getTracks().forEach(track => track.stop());
            this.barcodeStream = null;
        }
    }

    scanBarcodeFrame() {
        if (!this.scanning) return;
        const video = document.getElementById('barcodeVideo');
        const canvas = document.getElementById('barcodeCanvas');
        const status = document.getElementById('scanStatus');

        if (video.readyState === video.HAVE_ENOUGH_DATA) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const context = canvas.getContext('2d');
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            const imageData = context.getImageData(0, 0, canvas.width, canvas.height);

            if (window.BarcodeDetector) {
                const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
                detector.detect(canvas)
                    .then(codes => {
                        if (codes.length > 0) {
                            const code = codes[0].rawValue;
                            this.handleDetectedBarcode(code);
                        } else {
                            if (this.scanning) requestAnimationFrame(() => this.scanBarcodeFrame());
                        }
                    })
                    .catch(() => {
                        if (this.scanning) requestAnimationFrame(() => this.scanBarcodeFrame());
                    });
            } else if (window.jsQR) {
                const code = jsQR(imageData.data, imageData.width, imageData.height);
                if (code && code.data) {
                    this.handleDetectedBarcode(code.data);
                } else if (this.scanning) {
                    requestAnimationFrame(() => this.scanBarcodeFrame());
                }
            } else {
                status.textContent = 'Tu navegador no soporta lectura de códigos. Usa búsqueda manual.';
                this.scanning = false;
            }
        } else {
            requestAnimationFrame(() => this.scanBarcodeFrame());
        }
    }

    handleDetectedBarcode(barcode) {
        this.scanning = false; // Detiene el bucle de requestAnimationFrame
        document.getElementById('productBarcode').value = barcode;
        document.getElementById('scanStatus').textContent = `Código detectado: ${barcode}`;
        this.fetchProductInfoByBarcode(barcode);
    }

    playBeep() {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) return;
            
            const audioCtx = new AudioContext();
            const oscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);

            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // Nota La (A5)
            gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);

            oscillator.start(audioCtx.currentTime);
            oscillator.stop(audioCtx.currentTime + 0.2);
        } catch (e) {
            console.warn('No se pudo reproducir el sonido de confirmación:', e);
        }
    }

    async fetchProductInfoByBarcode(barcode) {
        const status = document.getElementById('scanStatus');
        status.textContent = 'Buscando producto...';

        // Lista de bases de datos a consultar
        const bases = [
            'world.openfoodfacts.org',
            'world.openbeautyfacts.org',
            'world.openproductsfacts.org'
        ];

        for (const base of bases) {
            try {
                const response = await fetch(`https://${base}/api/v0/product/${barcode}.json`);
                const data = await response.json();

                if (data.status === 1 && data.product) {
                    this.populateProductFieldsFromFoodFacts(data.product, barcode);
                    this.playBeep();
                    status.textContent = 'Producto encontrado!';
                    this.closeScanModal();
                    return; // Salimos si lo encontramos
                }
            } catch (error) {
                console.warn(`No encontrado en ${base}`);
            }
        }

        status.textContent = 'No encontrado. Introduce datos manualmente.';
        alert('No se encontró el producto en ninguna base de datos.');
        this.closeScanModal();
    }

    populateProductFieldsFromFoodFacts(product, barcode) {
        const name = product.product_name || product.generic_name || product.brands || '';
        if (name) {
            document.getElementById('productName').value = name;
        }
        document.getElementById('productBarcode').value = barcode;

        const categoryTags = product.categories_tags || [];
        const category = this.mapFoodFactsCategory(categoryTags);
        if (category) {
            document.getElementById('productCategory').value = category;
        }

        const perishable = this.mapFoodFactsPerishable(categoryTags);
        document.getElementById('productPerishable').checked = perishable;

        if (category === 'dairy' || category === 'produce' || category === 'meat' || category === 'beverages') {
            document.getElementById('productLocation').value = 'fridge';
        }

        if (product.quantity) {
            const quantity = this.extractQuantity(product.quantity);
            if (quantity) {
                document.getElementById('productQuantity').value = quantity.value;
                document.getElementById('productUnit').value = quantity.unit;
            }
        }

        document.getElementById('productNotes').value = product.brands ? `Marca: ${product.brands}` : '';
    }

    mapFoodFactsCategory(tags) {
        const categoryMap = {
            dairy: ['milk', 'cheese', 'yogurt', 'cream', 'dairy'],
            beverages: ['drink', 'beverage', 'soda', 'juice', 'water', 'cola'],
            produce: ['fruit', 'vegetable', 'salad', 'produce', 'tomato', 'apple', 'banana'],
            meat: ['meat', 'chicken', 'beef', 'pork', 'ham', 'sausages'],
            frozen: ['frozen'],
            pantry: ['bread', 'cereal', 'sauce', 'pasta', 'rice', 'flour', 'sugar', 'salt', 'snack'],
            drugstore: ['cleaning', 'detergent', 'shampoo', 'soap', 'hygiene', 'beauty', 'cosmetic', 'perfume', 'gel', 'dishwash'],
        };

        const lowerTags = tags.map(tag => tag.toLowerCase());
        for (const [category, keywords] of Object.entries(categoryMap)) {
            if (keywords.some(keyword => lowerTags.some(tag => tag.includes(keyword)))) {
                return category;
            }
        }
        return 'other';
    }

    mapFoodFactsPerishable(tags) {
        return tags.some(tag => ['milk', 'cheese', 'yogurt', 'meat', 'fresh', 'dairy', 'fish'].some(keyword => tag.toLowerCase().includes(keyword)));
    }

    extractQuantity(quantityText) {
        const match = quantityText.match(/([0-9]+(?:[,\.][0-9]+)?)\s*(g|kg|ml|l|cl|unidad|u)/i);
        if (match) {
            const value = parseFloat(match[1].replace(',', '.'));
            let unit = match[2].toLowerCase();
            if (unit === 'u') unit = 'unidad';
            return { value, unit };
        }
        return null;
    }

    handleProductSubmit(e) {
        e.preventDefault();

        const data = {
            barcode: document.getElementById('productBarcode').value.trim(),
            name: document.getElementById('productName').value,
            category: document.getElementById('productCategory').value,
            location: document.getElementById('productLocation').value,
            quantity: document.getElementById('productQuantity').value,
            unit: document.getElementById('productUnit').value,
            expiryDate: document.getElementById('productExpiry').value,
            notes: document.getElementById('productNotes').value,
            perishable: document.getElementById('productPerishable').checked,
        };

        if (this.currentProduct) {
            this.updateProduct(this.currentProduct.firebaseId, data);
        } else {
            this.addProduct(data);
        }

        this.closeProductModal();
        this.render();
    }

    deleteCurrentProduct() {
        if (this.currentProduct && confirm('¿Eliminar este producto?')) {
            this.deleteProduct(this.currentProduct.firebaseId);
            this.closeProductModal();
            this.render();
        }
    }

    // ============ SHOPPING MODAL ============
    addNewShoppingItem() {
        const input = document.getElementById('newShoppingItem');
        const categorySelect = document.getElementById('newShoppingCategory');
        this.addShoppingItem(input.value, categorySelect.value);
        input.value = '';
    }

    async addFromOFFResults(index) {
        const p = this.offSearchResults[index];
        if (!p) return;

        const metadata = {
            brand: p.brand,
            weight: p.weight,
            barcode: p.barcode,
            unit: p.unit
        };

        await this.addShoppingItem(p.name, p.category, p.imageUrl, p.notes, metadata);

        // Limpiar el buscador para ver la lista completa actualizada
        this.shoppingSearch = '';
        const searchInput = document.getElementById('shoppingSearchInput');
        if (searchInput) searchInput.value = '';
        this.renderShoppingList();
    }

    async searchOpenFoodFacts(query) {
        if (query.length < 3) return;
        const status = document.getElementById('shoppingStatus');
        if (status) status.textContent = 'Buscando en internet...';

        try {
            const response = await fetch(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=10`);
            const data = await response.json();
            
            this.offSearchResults = data.products.map(p => ({
                name: p.product_name || p.generic_name || 'Producto desconocido',
                imageUrl: p.image_small_url || null,
                category: this.mapFoodFactsCategory(p.categories_tags || []),
                notes: p.brands ? `Marca: ${p.brands}` : '',
                brand: p.brands || '',
                barcode: p.code || '',
                weight: p.quantity || '',
                unit: this.extractQuantity(p.quantity || '')?.unit || ''
            }));
            
            this.renderShoppingList();
        } catch (error) {
            console.error('Error buscando en OFF:', error);
        } finally {
            if (status) status.textContent = '';
        }
    }

    // ============ CATEGORY FILTERING FROM DASHBOARD ============
    showCategoryInventory(categoryKey) {
        this.switchTab('inventory');
        document.getElementById('searchInput').value = ''; // Clear search when switching to category view

        // Reset main filter buttons to 'all' visually
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('.filter-btn[data-filter="all"]').classList.add('active');

        // Set the inventory filter state
        this.currentInventoryFilterType = 'category';
        this.currentInventoryFilterValue = categoryKey;
        this.renderInventory(''); // Render with the new category filter
    }
    // ============ LOCATION MODAL ============
    showLocationModal() {
        this.renderLocationsList();
        document.getElementById('locationModal').classList.add('active');
    }

    closeLocationModal() {
        document.getElementById('locationModal').classList.remove('active');
    }

    addNewLocation() {
        const input = document.getElementById('newLocationName');
        const name = input.value.trim();
        if (!name) return;
        
        this.addLocation(name);
        input.value = '';
        this.renderLocationsList();
    }

    renderLocationsList() {
        const list = document.getElementById('locationsList');
        list.innerHTML = this.locations.map(loc => `
            <div class="location-item">
                <div class="location-item-name">${loc.name}</div>
                <div class="location-item-buttons">
                    ${loc.id === this.currentLocationId ? 
                        `<span class="location-item-badge">Actual</span>` : 
                        `<button class="location-item-btn" onclick="app.setCurrentLocation('${loc.id}');" title="Seleccionar">👁️</button>`
                    }
                    ${this.locations.length > 1 ? 
                        `<button class="location-item-btn delete" onclick="app.deleteLocationConfirm('${loc.id}');" title="Eliminar">🗑️</button>` : 
                        ''
                    }
                </div>
            </div>
        `).join('');
    }

    deleteLocationConfirm(id) {
        if (confirm('¿Eliminar esta vivienda? También se eliminarán todos sus productos.')) {
            this.deleteLocation(id);
        }
    }

    // ============ SETTINGS ============
    async saveSettings() {
        if (!this.firestoreEnabled || !this.db) return;

        try {
            await this.db.collection('settings').doc('global').set(this.settings, { merge: true });
        } catch (error) {
            console.error('Error al guardar settings:', error);
        }
    }

    showSettingsModal() {
        document.getElementById('settingsModal').classList.add('active');
        document.getElementById('expiryDays').value = this.settings.expiryDays;
        document.getElementById('userName').value = this.settings.userName || '';
        this.renderFirestoreStatus();
    }

    closeSettingsModal() {
        document.getElementById('settingsModal').classList.remove('active');
    }

    renderFirestoreStatus(message = null) {
        const statusElement = document.getElementById('firestoreStatus');
        if (!statusElement) return;

        if (message) {
            statusElement.textContent = message;
            return;
        }

        if (this.firestoreEnabled && this.db) {
            statusElement.textContent = '✅ Firestore activo y sincronizado en tiempo real';
        } else if (typeof FIREBASE_ENABLED === 'undefined' || !FIREBASE_ENABLED) {
            statusElement.textContent = '❌ Firestore no configurado';
        } else {
            statusElement.textContent = '⚠️ Firestore configurado, pero sin conexión';
        }
    }

    exportData() {
        const data = {
            products: this.products,
            shoppingList: this.shoppingList,
            locations: this.locations,
            settings: this.settings,
            exportedAt: new Date().toISOString(),
        };

        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `midespensa_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    async importData(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const data = JSON.parse(event.target.result);
                await this.importFirestoreData(data);
                alert('Datos importados correctamente!');
                this.loadAllData();
            } catch (error) {
                console.error('Error al importar datos:', error);
                alert('Error al importar datos: ' + error.message);
            }
        };
        reader.readAsText(file);
    }

    async importFirestoreData(data) {
        if (!this.firestoreEnabled || !this.db) {
            throw new Error('No hay conexión a Firestore.');
        }

        if (!Array.isArray(data.locations) || !Array.isArray(data.products)) {
            throw new Error('Estructura de datos inválida.');
        }

        const batch = this.db.batch();
        const locationIdMap = new Map();
        let firstNewLocationId = null;

        // 1. Procesar Viviendas
        for (const location of data.locations) {
            const newLocRef = this.db.collection('locations').doc();
            if (!firstNewLocationId) firstNewLocationId = newLocRef.id;
            
            locationIdMap.set(String(location.id), newLocRef.id);
            batch.set(newLocRef, {
                name: location.name || 'Sin nombre',
                note: location.note || '',
                createdAt: location.createdAt ? new Date(location.createdAt) : new Date(),
                lastUpdateBy: location.lastUpdateBy || '',
                lastUpdateAt: location.lastUpdateAt ? new Date(location.lastUpdateAt) : new Date(),
            });
        }

        // 2. Procesar Productos
        for (const product of data.products) {
            const mappedLocationId = locationIdMap.get(String(product.locationId)) || firstNewLocationId;
            if (!mappedLocationId) continue;

            const newProdRef = this.db.collection('locations').doc(mappedLocationId).collection('products').doc();
            batch.set(newProdRef, {
                name: product.name || '',
                category: product.category || '',
                location: product.location || '',
                quantity: product.quantity != null ? parseFloat(product.quantity) : 1,
                unit: product.unit || '',
                expiryDate: (product.expiryDate && product.expiryDate !== 'null') ? new Date(product.expiryDate) : null,
                notes: product.notes || '',
                perishable: !!product.perishable,
                barcode: product.barcode || '',
                createdAt: product.createdAt ? new Date(product.createdAt) : new Date(),
            });
        }

        // 3. Procesar Lista de la Compra
        if (Array.isArray(data.shoppingList)) {
            for (const item of data.shoppingList) {
                const newItemRef = this.db.collection('shoppingList').doc();
                batch.set(newItemRef, {
                    name: item.name || '',
                    completed: !!item.completed,
                    createdAt: item.createdAt ? new Date(item.createdAt) : new Date(),
                });
            }
        }

        // 4. Procesar Configuración Global
        if (data.settings) {
            const settingsPayload = {
                expiryDays: data.settings.expiryDays != null ? data.settings.expiryDays : 2,
                userName: data.settings.userName || '',
                currentLocationId: locationIdMap.get(String(data.currentLocationId)) || firstNewLocationId || null,
            };
            batch.set(this.db.collection('settings').doc('global'), settingsPayload, { merge: true });
        }

        await batch.commit();
    }

    async clearAllData() {
        if (confirm('⚠️ ¿Borrar TODOS los datos? Esta acción no se puede deshacer.')) {
            if (!this.firestoreEnabled || !this.db) {
                alert('No hay conexión a Firestore');
                return;
            }

            try {
                const locationsSnapshot = await this.db.collection('locations').get();
                for (const locDoc of locationsSnapshot.docs) {
                    const productsSnapshot = await locDoc.ref.collection('products').get();
                    const batch = this.db.batch();
                    productsSnapshot.forEach(doc => {
                        batch.delete(doc.ref);
                    });
                    batch.delete(locDoc.ref);
                    await batch.commit();
                }

                const shoppingSnapshot = await this.db.collection('shoppingList').get();
                const shoppingBatch = this.db.batch();
                shoppingSnapshot.forEach(doc => {
                    shoppingBatch.delete(doc.ref);
                });
                await shoppingBatch.commit();

                await this.db.collection('settings').doc('global').delete();

                this.render();
                this.closeSettingsModal();
                alert('Todos los datos han sido eliminados');
            } catch (error) {
                console.error('Error al limpiar datos:', error);
                alert('Error al eliminar los datos');
            }
        }
    }

    // ============ RENDERING ============
    render() {
        this.renderDashboard();
        this.renderInventory();
        this.renderNotes();
        this.renderShoppingList();
    }

    renderDashboard() {
        const stats = this.getStats();
        const expiring = this.getExpiringProducts();
        const categories = this.getProductsByCategory();

        // Banner de última visita
        const location = this.getCurrentLocation();
        const banner = document.getElementById('lastVisitBanner');
        if (banner) {
            if (location && location.lastUpdateBy) {
                banner.style.display = 'block';
                banner.innerHTML = `
                    <i class="fas fa-history"></i> 
                    Última revisión: <strong>${location.lastUpdateBy}</strong> el ${this.formatDateFull(location.lastUpdateAt)}
                `;
            } else {
                banner.style.display = 'none';
            }
        }

        // Update stats
        document.getElementById('totalItems').textContent = stats.total;
        document.getElementById('expiringSoon').textContent = stats.expiring;
        document.getElementById('expired').textContent = stats.expired;

        // Expiring list
        const expiringList = document.getElementById('expiringList');
        const expiringSection = document.getElementById('expiringSection');
        if (expiring.length > 0) {
            expiringList.innerHTML = expiring.map(p => `
                <div class="product-item" onclick="app.showProductModal(app.getProduct('${p.firebaseId}'))">
                    <div class="product-info">
                        <div class="product-name">${p.name}</div>
                        <div class="product-meta">
                            ${p.location === 'fridge' ? '🧊' : p.location === 'freezer' ? '❄️' : '🍞'} 
                            ${p.quantity} ${p.unit}
                        </div>
                        <div class="product-date ${this.getExpiryStatus(p) === 'expired' ? 'danger' : 'warning'}">
                            Vence: ${this.formatDateFull(p.expiryDate)}
                        </div>
                    </div>
                    <button class="product-btn" onclick="event.stopPropagation(); app.consumeProduct('${p.firebaseId}')">
                        ✓
                    </button>
                </div>
            `).join('');
            expiringSection.style.display = 'block';
        } else {
            expiringSection.style.display = 'none';
        }

        // Categories
        const categoryBreakdown = document.getElementById('categoryBreakdown');
        categoryBreakdown.innerHTML = Object.entries(categories)
            .filter(([_, cat]) => cat.count > 0)
            .map(([key, cat]) => `
                <div class="category-item" onclick="app.showCategoryInventory('${key}')">
                    <span class="category-icon">${cat.icon}</span>
                    <div class="category-name">${cat.name}</div>
                    <div class="category-count">${cat.count} ${cat.count === 1 ? 'item' : 'items'}</div>
                </div>
            `).join('');
    }

    getCategoryName(categoryKey) {
        const names = {
            dairy: 'Lácteos',
            beverages: 'Bebidas',
            produce: 'Frutas/Verduras',
            meat: 'Carnes',
            frozen: 'Congelados',
            pantry: 'Despensa',
            drugstore: 'Droguería',
            other: 'Otros',
        };
        return names[categoryKey] || 'Categoría';
    }

    getInventoryFilterLabel() {
        if (this.currentInventoryFilterType === 'category') {
            const categoryName = this.getCategoryName(this.currentInventoryFilterValue);
            return `Categoría: ${categoryName}`;
        }
        if (this.currentInventoryFilterType === 'perishable') return 'Perecederos';
        if (this.currentInventoryFilterType === 'fridge') return 'Frigo';
        if (this.currentInventoryFilterType === 'expired') return 'Vencidos';
        return 'Todos';
    }

    renderInventory(search = '') {
        const inventoryStatus = document.getElementById('inventoryStatus');
        const isSpeaking = window.speechSynthesis.speaking;
        const stopBtnStyle = isSpeaking ? 'inline-block' : 'none';
        if (inventoryStatus) {
            inventoryStatus.innerHTML = `Mostrando: ${this.getInventoryFilterLabel()} 
                <button class="product-btn" style="color: #1e3a8a; font-size: 1.1rem; display: inline-block; vertical-align: middle; padding: 0 0.5rem;" onclick="app.readFilteredProductsAloud()" title="Leer lista actual"><i class="fas fa-volume-up"></i></button>
                <button class="product-btn stop-voice-btn" style="color: var(--danger); font-size: 1.1rem; display: ${stopBtnStyle}; vertical-align: middle; padding: 0 0.5rem;" onclick="app.stopSpeaking()" title="Detener voz"><i class="fas fa-stop-circle"></i></button>`;
        }

        const filtered = this.filterProducts(search, this.currentInventoryFilterType, this.currentInventoryFilterValue);
        const inventoryList = document.getElementById('inventoryList');

        if (filtered.length === 0) {
            inventoryList.innerHTML = '<p class="empty-state">No hay productos 🤷‍♂️</p>';
            return;
        }

        // Sort by expiry date
        filtered.sort((a, b) => {
            const daysA = this.getDaysUntilExpiry(a.expiryDate);
            const daysB = this.getDaysUntilExpiry(b.expiryDate);
            if (daysA === null) return 1;
            if (daysB === null) return -1;
            return daysA - daysB;
        });

        inventoryList.innerHTML = filtered.map(p => {
            const status = this.getExpiryStatus(p);
            const daysLeft = this.getDaysUntilExpiry(p.expiryDate);
            let daysText = '';
            if (status === 'expired') {
                daysText = 'VENCIDO';
            } else if (status === 'expiring') {
                daysText = `Vence en ${daysLeft} ${daysLeft === 1 ? 'día' : 'días'}`;
            }

            return `
                <div class="product-item" onclick="app.showProductModal(app.getProduct('${p.firebaseId}'))">
                    <div class="product-info">
                        <div class="product-name">${p.name}</div>
                        <div class="product-meta">
                            <span class="product-badge ${p.perishable ? 'perishable' : ''}">${p.category === 'dairy' ? '🥛' : p.category === 'beverages' ? '🥤' : p.category === 'produce' ? '🥬' : p.category === 'meat' ? '🍗' : p.category === 'frozen' ? '❄️' : p.category === 'pantry' ? '🍞' : p.category === 'drugstore' ? '🧼' : '📦'}</span>
                            <span class="product-badge ${p.location === 'fridge' || p.location === 'freezer' ? 'fridge' : ''}">${p.location === 'fridge' ? '🧊 Frigo' : p.location === 'freezer' ? '❄️ Congelador' : '🍞 Despensa'}</span>
                            ${p.perishable ? '<span class="product-badge perishable">Perecedero</span>' : ''}
                        </div>
                        ${p.quantity ? `<div class="product-meta">📦 ${p.quantity} ${p.unit}</div>` : ''}
                        ${p.expiryDate ? `<div class="product-date ${status === 'expired' ? 'danger' : status === 'expiring' ? 'warning' : ''}">${daysText ? daysText : 'Vence: ' + this.formatDateFull(p.expiryDate)}</div>` : ''}
                        ${p.barcode ? `<div class="product-meta" style="color: #999; font-size: 0.8rem;">🔎 ${p.barcode}</div>` : ''}
                        ${p.notes ? `<div class="product-meta" style="color: #999; font-size: 0.8rem;">📝 ${p.notes}</div>` : ''}
                    </div>
                    <div class="product-actions">
                        <button class="product-btn" onclick="event.stopPropagation(); app.consumeProduct('${p.firebaseId}')" title="Eliminar">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }

    renderShoppingList() {
        const list = document.getElementById('shoppingList');
        const clearBtn = document.getElementById('clearShoppingBtn');
        const shareBtn = document.getElementById('shareWhatsAppBtn');
        const container = document.querySelector('.shopping-container');

        if (this.shoppingList.length === 0) {
            list.innerHTML = '<p class="empty-state">Lista vacía</p>';
            clearBtn.style.display = 'none';
            if (shareBtn) shareBtn.style.display = 'none';
            const existingSearch = document.getElementById('shoppingSearchInput');
            if (existingSearch) existingSearch.parentElement.remove();
            return;
        }

        // Inyectar buscador si no existe (Mejora para listas largas)
        if (container && !document.getElementById('shoppingSearchInput')) {
            const searchDiv = document.createElement('div');
            searchDiv.style.display = 'flex';
            searchDiv.style.gap = '0.5rem';
            searchDiv.style.marginBottom = '1rem';
            searchDiv.style.alignItems = 'center';
            
            searchDiv.innerHTML = `
                <div class="search-bar" style="margin-bottom: 0; flex: 1; padding: 0 0.5rem;">
                    <i class="fas fa-search" style="font-size: 0.8rem;"></i>
                    <input type="text" id="shoppingSearchInput" placeholder="Buscar..." value="${this.shoppingSearch}" style="padding: 0.5rem 0; font-size: 0.9rem;">
                </div>
                <button class="btn btn-secondary btn-small" id="toggleCatalogBtn">
                    <i class="fas fa-eye-slash"></i>
                </button>
            `;
            container.insertBefore(searchDiv, list);
            
            document.getElementById('shoppingSearchInput').addEventListener('input', (e) => {
                this.shoppingSearch = e.target.value;
                this.renderShoppingList();
            });
            document.getElementById('toggleCatalogBtn').addEventListener('click', () => {
                this.hideCatalog = !this.hideCatalog;
                this.renderShoppingList();
            });
        }
        
        // Inyectar estado de carga si no existe
        if (container && !document.getElementById('shoppingStatus')) {
            const statusDiv = document.createElement('div');
            statusDiv.id = 'shoppingStatus';
            statusDiv.style.fontSize = '0.8rem';
            statusDiv.style.color = 'var(--primary)';
            statusDiv.style.textAlign = 'center';
            container.insertBefore(statusDiv, list);
        }

        const toggleBtn = document.getElementById('toggleCatalogBtn');
        if (toggleBtn) {
            toggleBtn.className = `btn ${this.hideCatalog ? 'btn-primary' : 'btn-secondary'} btn-small`;
            toggleBtn.innerHTML = `<i class="fas ${this.hideCatalog ? 'fa-eye' : 'fa-eye-slash'}"></i>`;
            toggleBtn.title = this.hideCatalog ? 'Mostrar catálogo' : 'Modo compra (ocultar catálogo)';
        }

        clearBtn.style.display = 'block';
        clearBtn.innerHTML = '<i class="fas fa-trash-alt"></i> Limpiar Carrito';
        clearBtn.title = "Quitar todos los productos del carrito y volver al catálogo";
        clearBtn.className = 'btn btn-secondary btn-small';

        if (shareBtn) shareBtn.style.display = 'block';
        
        // Filtrar por búsqueda
        let filteredItems = this.shoppingList;
        if (this.shoppingSearch) {
            filteredItems = filteredItems.filter(i => 
                i.name.toLowerCase().includes(this.shoppingSearch.toLowerCase())
            );
        }

        const categoryMeta = {
            dairy: { icon: '🥛', name: 'Lácteos' },
            beverages: { icon: '🥤', name: 'Bebidas' },
            produce: { icon: '🥬', name: 'Frutas/Verduras' },
            meat: { icon: '🍗', name: 'Carnes' },
            frozen: { icon: '❄️', name: 'Congelados' },
            pantry: { icon: '🍞', name: 'Despensa' },
            drugstore: { icon: '🧼', name: 'Droguería' },
            other: { icon: '📦', name: 'Otros' },
        };

        const isSearching = this.shoppingSearch.length > 0;
        // El catálogo oculta productos que ya están en el carrito para no duplicar, 
        // pero al buscar permitimos verlos marcados para dar contexto.
        const catalog = filteredItems.filter(i => !i.inCart || (isSearching && i.inCart)).sort((a, b) => a.name.localeCompare(b.name));
        const toBuy = filteredItems.filter(i => i.inCart && !i.completed);
        const completed = filteredItems.filter(i => i.inCart && i.completed).sort((a, b) => a.name.localeCompare(b.name));

        // Agrupar pendientes por categoría
        const grouped = {};
        toBuy.forEach(item => {
            const cat = item.category || 'other';
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(item);
        });

        let html = '';
        
        // 1. SECCIÓN: POR COMPRAR (CARRITO)
        if (toBuy.length > 0) {
            html += `<div class="shopping-category-header" style="background: #fff9db; color: #f08c00;">🛒 Carrito (Pendiente)</div>`;
            Object.keys(categoryMeta).forEach(catKey => {
                if (grouped[catKey] && grouped[catKey].length > 0) {
                    // Ordenar alfabéticamente dentro de cada categoría
                    grouped[catKey].sort((a, b) => a.name.localeCompare(b.name));
                    html += `<div class="shopping-category-header" style="font-size: 0.65rem; padding-left: 2rem; opacity: 0.8;">${categoryMeta[catKey].icon} ${categoryMeta[catKey].name}</div>`;
                    html += grouped[catKey].map(item => this.renderShoppingItemRow(item, true)).join('');
                }
            });
        }

        // 2. SECCIÓN: CATÁLOGO LOCAL / BASE
        if (!this.hideCatalog && catalog.length > 0) {
            html += `<div class="shopping-category-header" style="background: #f1f3f5; color: #495057;">📁 Catálogo (Añadir al carrito)</div>`;
            html += catalog.map(item => this.renderShoppingItemRow(item, false)).join('');
        }

        // 3. SECCIÓN: COMPRADO
        if (completed.length > 0) {
            html += `<div class="shopping-category-header" style="background: #ebfbee; color: #2b8a3e;">✅ Comprado</div>`;
            html += completed.map(item => this.renderShoppingItemRow(item, true)).join('');
        }

        // 4. SECCIÓN: RESULTADOS DE OPEN FOOD FACTS (Internet)
        if (!this.hideCatalog && this.offSearchResults.length > 0) {
            html += `<div class="shopping-category-header" style="background: #e7f5ff; color: #1971c2;">🌍 Resultados en Internet</div>`;
            html += this.offSearchResults.map((p, index) => {
                const localMatch = this.shoppingList.find(i => i.name.toLowerCase() === p.name.toLowerCase());
                // Si ya está en el carrito actual, desaparece de la lista de internet para evitar ruido
                if (localMatch && localMatch.inCart) return '';

                const escapedName = p.name.replace(/'/g, "\\'");
                const escapedNotes = (p.notes || '').replace(/'/g, "\\'");
                const escapedImg = (p.imageUrl || '').replace(/'/g, "\\'");

                return `
                <div class="shopping-item">
                    <button class="product-btn" onclick="app.addFromOFFResults(${index});" style="color: ${localMatch ? 'var(--success)' : 'var(--primary)'};" title="${localMatch ? 'Actualizar y añadir al carrito' : 'Descargar al catálogo'}">
                        <i class="fas ${localMatch ? 'fa-cart-plus' : 'fa-cloud-download-alt'}"></i>
                    </button>
                    ${p.imageUrl ? `<img src="${p.imageUrl}" style="width: 30px; height: 30px; border-radius: 4px; object-fit: cover;" onclick="app.showImagePreview('${escapedName}', '${escapedImg}', '${escapedNotes}')">` : ''}
                <label style="color: var(--gray-dark); font-weight: normal; font-size: 0.9rem; cursor: pointer;" onclick="app.showImagePreview('${escapedName}', '${escapedImg}', '${escapedNotes}')">
                    ${p.name} <small style="color: var(--gray);">${p.brand ? '[' + p.brand + ']' : ''} ${p.weight || ''}</small>
                </label>
                </div>
            `;}).join('');
        } else if (!this.hideCatalog && this.shoppingSearch.length >= 3) {
            html += `<div style="padding: 1rem; text-align: center;">
                <button class="btn btn-secondary btn-small" onclick="app.searchOpenFoodFacts('${this.shoppingSearch.replace(/'/g, "\\'")}');">
                    <i class="fas fa-search"></i> Buscar "${this.shoppingSearch}" en internet
                </button>
            </div>`;
        }

        list.innerHTML = html;
    }

    renderShoppingItemRow(item, isInCart) {
        const escapedName = (item.name || '').replace(/'/g, "\\'");
        const escapedNotes = (item.notes || '').replace(/'/g, "\\'");
        const escapedImg = (item.imageUrl || '').replace(/'/g, "\\'");

        return `
            <div class="shopping-item ${isInCart ? 'in-cart-item' : ''}" style="${!isInCart && item.inCart ? 'opacity: 0.5;' : ''}">
                ${item.imageUrl ? `<img src="${item.imageUrl}" style="width: 30px; height: 30px; border-radius: 4px; object-fit: cover; opacity: ${item.completed ? '0.5' : '1'}" onclick="app.showImagePreview('${escapedName}', '${escapedImg}', '${escapedNotes}')">` : ''}
                ${isInCart ? 
                    `<input type="checkbox" id="item-${item.id}" ${item.completed ? 'checked' : ''} onchange="app.toggleShoppingItem('${item.id}');">` :
                    (item.inCart ? 
                        `<button class="product-btn" style="color: var(--gray);" title="Ya está en el carrito"><i class="fas fa-check-circle"></i></button>` :
                        `<button class="product-btn" onclick="app.toggleInCart('${item.id}', true);" style="color: var(--success);" title="Añadir al carrito"><i class="fas fa-cart-plus"></i></button>`
                    )
                }
                <label for="item-${item.id}" style="${!isInCart ? 'color: var(--gray); font-weight: normal; cursor: pointer;' : ''}" ${!isInCart ? `onclick="app.showImagePreview('${escapedName}', '${escapedImg}', '${escapedNotes}')"` : ''}>
                    ${item.name}
                    ${item.metadata && (item.metadata.brand || item.metadata.weight) ? 
                        `<div style="font-size: 0.7rem; opacity: 0.7;">${item.metadata.brand} ${item.metadata.weight}</div>` : ''}
                </label>
                <div class="product-actions">
                    ${isInCart ? 
                        `<button class="delete-btn" style="color: var(--warning);" onclick="app.toggleInCart('${item.id}', false);" title="Quitar del carrito"><i class="fas fa-minus-square"></i></button>` :
                        `<button class="delete-btn" onclick="app.deleteShoppingItem('${item.id}');" title="Eliminar del catálogo"><i class="fas fa-trash"></i></button>`
                    }
                </div>
            </div>`;
    }
    
    // ============ COMPARISON ENGINE ============
    async compareAllSupermarkets() {
        const shoppingItems = this.shoppingList.filter(i => i.inCart);
        if (shoppingItems.length === 0) {
            alert("Añade productos al carrito primero.");
            return;
        }

        const supers = ['Mercadona', 'Carrefour', 'Alcampo', 'Aldi', 'AhorraMás', 'Dia'];
        this.renderComparisonLoading("Calculando la mejor opción entre todos los supermercados...");
        
        document.getElementById('supermarketsList').style.display = 'none';
        document.getElementById('globalCompareActions').style.display = 'none';
        document.getElementById('comparisonResults').style.display = 'block';
        document.getElementById('comparisonTableResults').style.display = 'none';
        document.getElementById('backToSupersBtn').style.display = 'flex';

        // Simulamos peticiones en paralelo a todos los conectores
        const results = await Promise.all(supers.map(async (name) => {
            const data = await this.mockFetchSupermarketPrices(name, shoppingItems);
            return { name, ...data };
        }));

        // Encontrar el más barato
        const winner = results.reduce((min, curr) => parseFloat(curr.total) < parseFloat(min.total) ? curr : min, results[0]);
        
        this.selectedSupermarket = winner.name;
        document.getElementById('supermarketViewTitle').textContent = `🏆 El más barato: ${winner.name}`;
        document.getElementById('savingsBadge').style.display = 'block';
        this.renderComparisonResults(winner);
    }

    async selectSupermarket(name) {
        this.selectedSupermarket = name;
        const list = document.getElementById('supermarketsList');
        const results = document.getElementById('comparisonResults');
        const title = document.getElementById('supermarketViewTitle');
        const backBtn = document.getElementById('backToSupersBtn');
        const globalActions = document.getElementById('globalCompareActions');
        const shoppingItems = this.shoppingList.filter(i => i.inCart);

        if (shoppingItems.length === 0) {
            alert("Tu carrito está vacío. Añade productos para comparar precios.");
            return;
        }

        list.style.display = 'none';
        globalActions.style.display = 'none';
        results.style.display = 'block';
        backBtn.style.display = 'flex';
        document.getElementById('comparisonTableResults').style.display = 'none';
        document.getElementById('savingsBadge').style.display = 'none';
        title.textContent = `Precios en ${name}`;

        this.renderComparisonLoading();
        
        const data = await this.mockFetchSupermarketPrices(name, shoppingItems);
        this.renderComparisonResults(data);
    }

    async compareAllSupermarketsTable() {
        const shoppingItems = this.shoppingList.filter(i => i.inCart);
        if (shoppingItems.length === 0) {
            alert("Añade productos al carrito primero.");
            return;
        }

        const supers = ['Mercadona', 'Carrefour', 'Alcampo', 'Aldi', 'AhorraMás', 'Dia'];
        
        document.getElementById('supermarketsList').style.display = 'none';
        document.getElementById('globalCompareActions').style.display = 'none';
        document.getElementById('comparisonResults').style.display = 'none';
        document.getElementById('comparisonTableResults').style.display = 'block';
        document.getElementById('backToSupersBtn').style.display = 'flex';
        document.getElementById('supermarketViewTitle').textContent = '📊 Tabla Comparativa';

        const tableContainer = document.getElementById('comparisonTableResults');
        tableContainer.innerHTML = `<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Generando tabla comparativa...</p></div>`;

        // Peticiones en paralelo para obtener todos los precios
        const results = await Promise.all(supers.map(async (name) => {
            const data = await this.mockFetchSupermarketPrices(name, shoppingItems);
            return { name, items: data.items };
        }));

        this.renderComparisonTable(results, shoppingItems);
    }

    renderComparisonTable(results, shoppingItems) {
        const tableContainer = document.getElementById('comparisonTableResults');
        
        let html = `
            <table style="width: 100%; border-collapse: collapse; background: white; border-radius: 8px; font-size: 0.85rem; min-width: 600px;">
                <thead>
                    <tr style="background: var(--light); text-align: left;">
                        <th style="padding: 0.75rem; border-bottom: 2px solid var(--gray-light); position: sticky; left: 0; background: var(--light); z-index: 1;">Producto</th>
                        ${results.map(r => `<th style="padding: 0.75rem; border-bottom: 2px solid var(--gray-light); text-align: center;">${r.name}</th>`).join('')}
                    </tr>
                </thead>
                <tbody>
        `;

        shoppingItems.forEach((item, index) => {
            // Encontrar el precio mínimo ignorando los N/D
            const prices = results.map(r => parseFloat(r.items[index].price)).filter(p => !isNaN(p));
            const minPrice = Math.min(...prices);

            const escapedName = (item.name || '').replace(/'/g, "\\'");
            const escapedNotes = (item.notes || '').replace(/'/g, "\\'");
            const escapedImg = (item.imageUrl || '').replace(/'/g, "\\'");

            html += `
                <tr style="border-bottom: 1px solid var(--gray-light);">
                    <td style="padding: 0.75rem; font-weight: 600; position: sticky; left: 0; background: white; z-index: 1; border-right: 1px solid var(--gray-light); cursor: pointer;" title="Ver vista previa" onclick="app.showImagePreview('${escapedName}', '${escapedImg}', '${escapedNotes}')">
                        ${item.name}
                        <div style="font-size: 0.7rem; font-weight: normal; color: var(--gray);">${item.metadata?.brand || ''}</div>
                    </td>
                    ${results.map(r => {
                        const priceStr = r.items[index].price;
                        const isBestPrice = parseFloat(priceStr) === minPrice;
                        const highlightStyle = isBestPrice ? 'background-color: #dcfce7; color: #166534; font-weight: 700;' : 'color: var(--primary);';
                        return `<td style="padding: 0.75rem; text-align: center; ${highlightStyle}">${priceStr}</td>`;
                    }).join('')}
                </tr>
            `;
        });

        // Calcular los totales de cada supermercado para la fila final
        const supermarketTotals = results.map(r => 
            r.items.reduce((sum, item) => {
                const p = parseFloat(item.price);
                if (isNaN(p)) return sum;
                return sum + p;
            }, 0)
        );
        const minTotal = Math.min(...supermarketTotals);

        html += `
                </tbody>
                <tfoot>
                    <tr style="background: var(--light); font-weight: bold; border-top: 2px solid var(--gray-light);">
                        <td style="padding: 0.75rem; position: sticky; left: 0; background: var(--light); z-index: 1; border-right: 1px solid var(--gray-light);">TOTAL COMPRA</td>
                        ${results.map((r, i) => {
                            const total = supermarketTotals[i];
                            const isBestTotal = total === minTotal;
                            const highlightStyle = isBestTotal ? 'background-color: #dcfce7; color: #166534;' : 'color: var(--secondary);';
                            return `<td style="padding: 0.75rem; text-align: center; font-size: 1rem; ${highlightStyle}">${total.toFixed(2)} €</td>`;
                        }).join('')}
                    </tr>
                </tfoot>
            </table>
        `;
        tableContainer.innerHTML = html;
    }

    resetSupermarketView() {
        this.selectedSupermarket = null;
        document.getElementById('supermarketsList').style.display = 'grid';
        document.getElementById('globalCompareActions').style.display = 'flex';
        document.getElementById('comparisonResults').style.display = 'none';
        document.getElementById('comparisonTableResults').style.display = 'none';
        document.getElementById('backToSupersBtn').style.display = 'none';
        document.getElementById('supermarketViewTitle').textContent = '🛒 Comparativa de Precios';
    }

    async mockFetchSupermarketPrices(supermarket, items) {
        // Si es Carrefour, intentamos una búsqueda real a través de un proxy
        if (supermarket === 'Carrefour') {
            return await this.fetchCarrefourPrices(items);
        }
        if (supermarket === 'Mercadona') {
            return await this.fetchMercadonaPrices(items);
        }

        // Para el resto, mantenemos la simulación por ahora
        await new Promise(resolve => setTimeout(resolve, 300));
        return this.generateSimulatedPrices(supermarket, items);
    }

    async fetchMercadonaPrices(items) {
        const processedItems = [];
        let total = 0;

        const fetchMercadonaJson = async (query) => {
            const localProxyUrl = `http://127.0.0.1:3001/mercadona?q=${encodeURIComponent(query)}`;
            const fallbackProxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(`https://tienda.mercadona.es/api/v1/search/?query=${encodeURIComponent(query)}&limit=1`)}`;

            try {
                // Intentamos primero el proxy local
                console.log(`Intentando proxy local para: ${query}`);
                let response = await fetch(localProxyUrl).catch(() => null);

                if (!response || !response.ok) {
                    if (response) {
                        const errorText = await response.text().catch(() => '');
                        console.error(`Error ${response.status} del proxy:`, errorText.slice(0, 100));
                    }
                    console.warn(`Proxy local falló o no está iniciado. Intentando AllOrigins...`);
                    // Si falla el local o no está arrancado, intentamos el público AllOrigins
                    response = await fetch(fallbackProxyUrl).catch(() => null);
                }

                if (!response || !response.ok) {
                    console.error(`Ambos proxies fallaron para: ${query}`);
                    return null;
                }

                const contentType = response.headers.get("content-type");
                if (contentType && contentType.includes("application/json")) {
                    return await response.json();
                } else {
                    const textError = await response.text();
                    console.error('La respuesta no es JSON. Posible bloqueo de Mercadona.', textError.slice(0, 100));
                    return null;
                }
            } catch (err) {
                console.error('Error en fetchMercadonaJson:', err);
            }
            return null;
        };

        for (const item of items) {
            const query = item.barcode || item.name;
            const data = await fetchMercadonaJson(query);
            const result = data?.results?.[0] || data?.[0]; // Mercadona a veces devuelve array directo o envuelto

            if (result && result.price_instructions) {
                const price = parseFloat(result.price_instructions.unit_price);
                console.log(`Precio encontrado para ${item.name}: ${price}€`);

                if (!isNaN(price)) {
                    total += price;
                    processedItems.push({
                        ...item,
                        price: price.toFixed(2) + ' €',
                        matchConfidence: (item.barcode && result.ean === item.barcode) ? 100 : 80,
                        found: true
                    });
                } else {
                    console.warn(`Precio no numérico para ${item.name}`);
                    processedItems.push({ ...item, price: 'N/D', found: false });
                }
            } else {
                console.warn(`No se encontraron resultados en Mercadona para: ${query}`);
                processedItems.push({ ...item, price: 'N/D', found: false });
            }
            // Espera un poco más larga para no ser baneados rápidamente
            await new Promise(r => setTimeout(r, 800));
        }

        return { total: total.toFixed(2), items: processedItems };
    }

    async fetchCarrefourPrices(items) {
        const processedItems = [];
        let total = 0;
        const PROXY_URL = 'http://127.0.0.1:3000/carrefour';

        for (const item of items) {
            let foundData = null;
            // Definimos varios intentos: primero EAN, luego Nombre + Marca
            const searchQueries = [];
            if (item.barcode) searchQueries.push(item.barcode);
            searchQueries.push(`${item.name} ${item.metadata?.brand || ''}`.trim());

            for (const query of searchQueries) {
                if (foundData) break;

                try {
                    console.log(`[Carrefour] Consultando proxy para: ${query}`);
                    const response = await fetch(`${PROXY_URL}?q=${encodeURIComponent(query)}`);
                    
                    if (!response.ok) continue; // Si falla esta búsqueda, probamos la siguiente

                    const data = await response.json();
                    
                    if (data && data.precio) {
                        const priceStr = data.precio.replace(/[^\d,.]/g, '').replace(',', '.');
                        const price = parseFloat(priceStr);
                        
                        if (!isNaN(price)) {
                            total += price;
                            foundData = {
                                ...item,
                                price: price.toFixed(2) + ' €',
                                matchConfidence: query === item.barcode ? 100 : 85,
                                found: true,
                                url: data.url
                            };
                        }
                    }
                } catch (error) {
                    console.warn(`[Carrefour] Error buscando "${query}":`, error.message);
                }
            }

            if (foundData) {
                processedItems.push(foundData);
            } else {
                processedItems.push({ ...item, price: 'N/D', matchConfidence: 0, found: false });
            }

            await new Promise(r => setTimeout(r, 1000)); // Delay corto entre productos
        }

        return { total: total.toFixed(2), items: processedItems };
    }

    generateSimulatedPrices(supermarket, items) {
        let total = 0;
        const processedItems = items.map(item => {
            // Lógica de matching mejorada:
            let confidence = 50; // Base
            if (item.barcode) confidence = 100;
            else if (item.metadata?.brand && item.metadata?.weight) confidence = 90;
            else if (item.metadata?.brand) confidence = 75;

            // El precio base depende de si es marca reconocida (según metadata) o blanca
            const isPremium = item.metadata?.brand && !item.metadata.brand.toLowerCase().includes('hacendado');
            const basePrice = isPremium ? 2.5 : 0.9;
            const variance = Math.random() * 0.5;
            const price = basePrice + variance;
            
            total += price;
            
            return {
                ...item,
                price: price.toFixed(2) + " €",
                matchConfidence: confidence,
                found: true
            };
        });

        return { total: total.toFixed(2), items: processedItems };
    }

    renderComparisonLoading(message) {
        const container = document.getElementById('comparisonList');
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-spinner fa-spin" style="font-size: 2rem; color: var(--secondary);"></i>
                <p>${message || 'Consultando catálogo de ' + this.selectedSupermarket + '...'}</p>
            </div>`;
    }

    renderComparisonResults(data) {
        const container = document.getElementById('comparisonList');
        const totalEl = document.getElementById('supermarketTotal');
        
        totalEl.innerHTML = `Total en <strong>${this.selectedSupermarket}</strong>: <span style="color: var(--secondary); font-size: 1.4rem;">${data.total}€</span>`;

        container.innerHTML = data.items.map(item => `
            <div class="shopping-item">
                <div style="flex: 1;">
                    <div style="font-weight: 600;">${item.name} 
                        <span style="font-size: 0.75rem; font-weight: normal; color: var(--gray);">
                            ${item.metadata?.brand ? '(' + item.metadata.brand + ')' : ''} ${item.metadata?.weight || ''}
                        </span>
                    </div>
                    <div style="font-size: 0.75rem; color: var(--gray);">
                        ${item.barcode ? `<span><i class="fas fa-barcode"></i> ${item.barcode}</span>` : 'Matching por Atributos'}
                        <span style="margin-left: 10px; color: ${item.matchConfidence === 100 ? 'var(--success)' : 'var(--warning)'}">
                            <i class="fas fa-check-circle"></i> Confianza: ${item.matchConfidence}%
                        </span>
                    </div>
                </div>
                <div style="text-align: right;">
                    <div style="font-weight: bold; color: var(--primary);">${item.price}</div>
                    <div style="font-size: 0.7rem; color: var(--gray);">Est.</div>
                </div>
            </div>
        `).join('');
    }

    renderSupermarkets() {
        const list = document.getElementById('supermarketsList');
        if (!list) return;

        const supers = ['Mercadona', 'Carrefour', 'Alcampo', 'Aldi', 'AhorraMás', 'Dia'];
        const colors = {
            'Mercadona': '#00a650',
            'Carrefour': '#003896',
            'Alcampo': '#da291c',
            'Aldi': '#002855',
            'AhorraMás': '#f39200',
            'Dia': '#e1001a'
        };
        
        list.innerHTML = supers.map(name => `
            <div class="category-item" 
                 onclick="app.selectSupermarket('${name}')" 
                 style="border: 1px solid var(--gray-light); transition: transform 0.2s;">
                <span class="category-icon" style="color: ${colors[name] || 'var(--primary)'};">
                    <i class="fas fa-store"></i>
                </span>
                <div class="category-name">${name}</div>
                <div class="category-count" style="color: var(--gray); font-weight: bold;">Comparar lista</div>
            </div>
        `).join('');
    }
}

// Initialize app
const app = new MiDespensa();
