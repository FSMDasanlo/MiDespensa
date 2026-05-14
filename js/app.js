// Storage Management
const STORAGE_KEY = 'midespensa_data';
const SETTINGS_KEY = 'midespensa_settings';
const LOCATIONS_KEY = 'midespensa_locations';
const CURRENT_LOCATION_KEY = 'midespensa_current_location';
const FIRESTORE_DEVICE_KEY = 'midespensa_firestore_device_id';
const FIRESTORE_COLLECTION = 'midespensa_devices';

class MiDespensa {
    constructor() {
        this.products = [];
        this.shoppingList = [];
        this.locations = [];
        this.currentLocationId = null;
        this.settings = {
            expiryDays: 2,
            userName: '',
        };
        this.currentProduct = null;
        this.barcodeStream = null;
        this.scanning = false;
        this.firestoreEnabled = false;
        this.firestoreDocRef = null;
        this.init();
    }

    init() {
        this.loadData();
        this.initFirestore();
        this.initLocations();
        this.setupEventListeners();
        this.render();
    }

    initLocations() {
        if (this.locations.length === 0) {
            this.addLocation('Almenara');
            this.addLocation('Madrid');
        }
        if (!this.currentLocationId && this.locations.length > 0) {
            this.currentLocationId = this.locations[0].id;
        }
        this.saveData(true);
        this.updateLocationDisplay();
    }

    initFirestore() {
        if (typeof FIREBASE_ENABLED === 'undefined' || !FIREBASE_ENABLED) {
            this.firestoreEnabled = false;
            return;
        }

        try {
            firebase.initializeApp(FIREBASE_CONFIG);
            this.db = firebase.firestore();
            this.firestoreEnabled = true;
            const deviceId = localStorage.getItem(FIRESTORE_DEVICE_KEY) || this.createDeviceId();
            localStorage.setItem(FIRESTORE_DEVICE_KEY, deviceId);
            this.firestoreDocRef = this.db.collection(FIRESTORE_COLLECTION).doc(deviceId);
            this.loadFirestoreData();
            this.renderFirestoreStatus();
        } catch (error) {
            console.warn('Firestore initialization failed:', error);
            this.firestoreEnabled = false;
            this.renderFirestoreStatus('Firestore no disponible');
        }
    }

    createDeviceId() {
        return `device_${Math.random().toString(36).slice(2)}_${Date.now()}`;
    }

    loadFirestoreData() {
        if (!this.firestoreEnabled || !this.firestoreDocRef) return;

        this.firestoreDocRef.get()
            .then(doc => {
                if (doc.exists) {
                    this.mergeFirestoreData(doc.data());
                    this.render();
                }
            })
            .catch(error => {
                console.warn('No se pudo cargar Firestore:', error);
            });
    }

    mergeFirestoreData(data) {
        if (!data) return;

        this.products = Array.isArray(data.products) ? data.products : this.products;
        this.shoppingList = Array.isArray(data.shoppingList) ? data.shoppingList : this.shoppingList;
        this.locations = Array.isArray(data.locations) ? data.locations : this.locations;
        this.currentLocationId = data.currentLocationId || this.currentLocationId;
        this.settings = data.settings || this.settings;

        this.saveData(true);
    }

    // ============ DATA MANAGEMENT ============
    loadData() {
        const stored = localStorage.getItem(STORAGE_KEY);
        const settings = localStorage.getItem(SETTINGS_KEY);
        const locations = localStorage.getItem(LOCATIONS_KEY);
        const currentLocation = localStorage.getItem(CURRENT_LOCATION_KEY);
        
        if (stored) {
            this.products = JSON.parse(stored);
        }
        if (settings) {
            this.settings = JSON.parse(settings);
        }
        if (locations) {
            this.locations = JSON.parse(locations);
        }
        if (currentLocation) {
            this.currentLocationId = parseInt(currentLocation);
        }

        const storedShopping = localStorage.getItem('midespensa_shopping');
        if (storedShopping) {
            this.shoppingList = JSON.parse(storedShopping);
        }
    }

    saveData(skipFirestoreSync = false) {
        // Actualizar metadatos de la ubicación actual si hay un usuario definido
        const location = this.getCurrentLocation();
        if (location && this.settings.userName) {
            location.lastUpdateBy = this.settings.userName;
            location.lastUpdateAt = new Date().toISOString();
        }

        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.products));
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
        localStorage.setItem(LOCATIONS_KEY, JSON.stringify(this.locations));
        localStorage.setItem(CURRENT_LOCATION_KEY, this.currentLocationId);
        localStorage.setItem('midespensa_shopping', JSON.stringify(this.shoppingList));

        if (!skipFirestoreSync && this.firestoreEnabled) {
            this.saveFirestoreData();
        }
    }

    saveFirestoreData() {
        if (!this.firestoreEnabled || !this.firestoreDocRef) return;

        const payload = {
            products: this.products,
            shoppingList: this.shoppingList,
            locations: this.locations,
            currentLocationId: this.currentLocationId,
            settings: this.settings,
            updatedAt: new Date().toISOString(),
        };

        this.firestoreDocRef.set(payload, { merge: true })
            .then(() => this.renderFirestoreStatus())
            .catch(error => {
                console.warn('Error al guardar en Firestore:', error);
                this.renderFirestoreStatus('Error al sincronizar Firestore');
            });
    }

    // ============ PRODUCTS ============
    addProduct(data) {
        const product = {
            id: Date.now(),
            locationId: this.currentLocationId,
            barcode: data.barcode || '',
            name: data.name,
            category: data.category,
            location: data.location,
            quantity: parseInt(data.quantity) || 1,
            unit: data.unit,
            expiryDate: data.expiryDate || null,
            notes: data.notes,
            perishable: data.perishable,
            createdAt: new Date().toISOString(),
        };
        this.products.push(product);
        this.saveData();
        return product;
    }

    updateProduct(id, data) {
        const index = this.products.findIndex(p => p.id === id);
        if (index !== -1) {
            this.products[index] = {
                ...this.products[index],
                barcode: data.barcode || this.products[index].barcode || '',
                name: data.name,
                category: data.category,
                location: data.location,
                quantity: parseInt(data.quantity) || 1,
                unit: data.unit,
                expiryDate: data.expiryDate || null,
                notes: data.notes,
                perishable: data.perishable,
            };
            this.saveData();
        }
    }

    deleteProduct(id) {
        this.products = this.products.filter(p => p.id !== id);
        this.saveData();
    }

    getProduct(id) {
        return this.products.find(p => p.id === id);
    }

    consumeProduct(id) {
        this.deleteProduct(id);
        this.render();
    }

    // ============ LOCATIONS ============
    addLocation(name) {
        const location = {
            id: Date.now(),
            name: name,
            createdAt: new Date().toISOString(),
        };
        this.locations.push(location);
        this.saveData();
        return location;
    }

    deleteLocation(id) {
        // No permitir eliminar si es la única ubicación
        if (this.locations.length <= 1) {
            alert('Debes tener al menos una vivienda');
            return false;
        }
        // No permitir eliminar la ubicación actual
        if (this.currentLocationId === id) {
            alert('No puedes eliminar la vivienda actual. Selecciona otra primero.');
            return false;
        }
        // Eliminar productos asociados
        this.products = this.products.filter(p => p.locationId !== id);
        this.locations = this.locations.filter(l => l.id !== id);
        this.saveData();
        return true;
    }

    setCurrentLocation(id) {
        if (this.locations.find(l => l.id === id)) {
            this.currentLocationId = id;
            this.saveData();
            this.updateLocationDisplay();
            this.render();
            this.closeLocationModal();
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
    getDaysUntilExpiry(expiryDate) {
        if (!expiryDate) return null;
        const expiry = new Date(expiryDate);
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
        const d = new Date(date);
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        return `${day}/${month}`;
    }

    formatDateFull(date) {
        if (!date) return '';
        const d = new Date(date);
        const options = { weekday: 'short', month: 'short', day: 'numeric' };
        return d.toLocaleDateString('es-ES', options);
    }

    // ============ FILTERING ============
    filterProducts(filter, search = '') {
        let filtered = this.products.filter(p => p.locationId === this.currentLocationId);

        // Filter by type
        if (filter === 'perishable') {
            filtered = filtered.filter(p => p.perishable);
        } else if (filter === 'fridge') {
            filtered = filtered.filter(p => p.location === 'fridge' || p.location === 'freezer');
        } else if (filter === 'expired') {
            filtered = filtered.filter(p => this.isExpired(p));
        }

        // Filter by search
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
    addShoppingItem(name) {
        if (!name.trim()) return;
        const item = {
            id: Date.now(),
            name: name.trim(),
            completed: false,
            createdAt: new Date().toISOString(),
        };
        this.shoppingList.push(item);
        this.saveData();
    }

    toggleShoppingItem(id) {
        const item = this.shoppingList.find(i => i.id === id);
        if (item) {
            item.completed = !item.completed;
            this.saveData();
        }
    }

    deleteShoppingItem(id) {
        this.shoppingList = this.shoppingList.filter(i => i.id !== id);
        this.saveData();
    }

    clearShoppingList() {
        this.shoppingList = [];
        this.saveData();
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
                this.renderInventory(search, btn.dataset.filter);
            });
        });

        // Shopping List
        document.getElementById('addShoppingBtn').addEventListener('click', () => this.addNewShoppingItem());
        document.getElementById('newShoppingItem').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addNewShoppingItem();
        });
        document.getElementById('clearShoppingBtn').addEventListener('click', () => this.clearShoppingList());

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

        document.getElementById('expiryDays').addEventListener('change', (e) => {
            this.settings.expiryDays = parseInt(e.target.value);
            this.saveData();
            this.render();
        });
        document.getElementById('userName').addEventListener('change', (e) => {
            this.settings.userName = e.target.value.trim();
            this.saveData();
            this.render(); // Añadido para actualizar el dashboard
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

    fetchProductInfoByBarcode(barcode) {
        const status = document.getElementById('scanStatus');
        status.textContent = 'Buscando en Open Food Facts...';

        fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`)
            .then(response => response.json())
            .then(data => {
                if (data.status === 1 && data.product) {
                    status.textContent = 'Producto encontrado. Completando datos...';
                    this.populateProductFieldsFromFoodFacts(data.product, barcode);
                    document.getElementById('scanStatus').textContent = 'Datos cargados. Revisa y guarda.';
                } else {
                    status.textContent = 'Producto no encontrado en Open Food Facts. Puedes ingresarlo manualmente.';
                    alert('No se encontró el producto. Puedes ingresarlo manualmente.');
                }
            })
            .catch(error => {
                console.error('Error fetching product info:', error);
                status.textContent = 'Error al conectar con Open Food Facts. Intenta de nuevo.';
                alert('No se pudo conectar con Open Food Facts. Intenta de nuevo.');
            })
            .finally(() => {
                this.closeScanModal(); // Cierra el modal del escáner después de procesar la respuesta (éxito o error)
            });
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
            this.updateProduct(this.currentProduct.id, data);
        } else {
            this.addProduct(data);
        }

        this.closeProductModal();
        this.render();
    }

    deleteCurrentProduct() {
        if (this.currentProduct && confirm('¿Eliminar este producto?')) {
            this.deleteProduct(this.currentProduct.id);
            this.closeProductModal();
            this.render();
        }
    }

    // ============ SHOPPING MODAL ============
    addNewShoppingItem() {
        const input = document.getElementById('newShoppingItem');
        this.addShoppingItem(input.value);
        input.value = '';
        this.renderShoppingList();
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
                        `<button class="location-item-btn" onclick="app.setCurrentLocation(${loc.id});" title="Seleccionar">👁️</button>`
                    }
                    ${this.locations.length > 1 ? 
                        `<button class="location-item-btn delete" onclick="app.deleteLocationConfirm(${loc.id});" title="Eliminar">🗑️</button>` : 
                        ''
                    }
                </div>
            </div>
        `).join('');
    }

    deleteLocationConfirm(id) {
        if (confirm('¿Eliminar esta vivienda? También se eliminarán todos sus productos.')) {
            if (this.deleteLocation(id)) {
                this.renderLocationsList();
            }
        }
    }

    // ============ SETTINGS ============
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

        if (this.firestoreEnabled && this.firestoreDocRef) {
            statusElement.textContent = 'Firestore activo y sincronizado';
        } else if (typeof FIREBASE_ENABLED === 'undefined' || !FIREBASE_ENABLED) {
            statusElement.textContent = 'Firestore no configurado';
        } else {
            statusElement.textContent = 'Firestore configurado, pero sin conexión';
        }
    }

    exportData() {
        const data = {
            products: this.products,
            shoppingList: this.shoppingList,
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

    importData(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target.result);
                if (data.products && data.shoppingList) {
                    this.products = data.products;
                    this.shoppingList = data.shoppingList;
                    if (data.settings) this.settings = data.settings;
                    this.saveData();
                    this.render();
                    alert('Datos importados correctamente!');
                }
            } catch (error) {
                alert('Error al importar datos');
            }
        };
        reader.readAsText(file);
    }

    clearAllData() {
        if (confirm('⚠️ ¿Borrar TODOS los datos? Esta acción no se puede deshacer.')) {
            this.products = [];
            this.shoppingList = [];
            this.saveData();
            this.render();
            this.closeSettingsModal();
        }
    }

    // ============ RENDERING ============
    render() {
        this.renderDashboard();
        this.renderInventory();
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
        if (expiring.length > 0) {
            expiringList.innerHTML = expiring.map(p => `
                <div class="product-item" onclick="app.showProductModal(app.getProduct(${p.id}))">
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
                    <button class="product-btn" onclick="event.stopPropagation(); app.consumeProduct(${p.id})">
                        ✓
                    </button>
                </div>
            `).join('');
        }

        // Categories
        const categoryBreakdown = document.getElementById('categoryBreakdown');
        categoryBreakdown.innerHTML = Object.entries(categories)
            .filter(([_, cat]) => cat.count > 0)
            .map(([key, cat]) => `
                <div class="category-item">
                    <span class="category-icon">${cat.icon}</span>
                    <div class="category-name">${cat.name}</div>
                    <div class="category-count">${cat.count} ${cat.count === 1 ? 'item' : 'items'}</div>
                </div>
            `).join('');
    }

    renderInventory(search = '', filter = 'all') {
        const filtered = this.filterProducts(filter, search);
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
                <div class="product-item" onclick="app.showProductModal(app.getProduct(${p.id}))">
                    <div class="product-info">
                        <div class="product-name">${p.name}</div>
                        <div class="product-meta">
                            <span class="product-badge ${p.perishable ? 'perishable' : ''}">${p.category === 'dairy' ? '🥛' : p.category === 'beverages' ? '🥤' : p.category === 'produce' ? '🥬' : p.category === 'meat' ? '🍗' : p.category === 'frozen' ? '❄️' : p.category === 'pantry' ? '🍞' : '📦'}</span>
                            <span class="product-badge ${p.location === 'fridge' || p.location === 'freezer' ? 'fridge' : ''}">${p.location === 'fridge' ? '🧊 Frigo' : p.location === 'freezer' ? '❄️ Congelador' : '🍞 Despensa'}</span>
                            ${p.perishable ? '<span class="product-badge perishable">Perecedero</span>' : ''}
                        </div>
                        ${p.quantity ? `<div class="product-meta">📦 ${p.quantity} ${p.unit}</div>` : ''}
                        ${p.expiryDate ? `<div class="product-date ${status === 'expired' ? 'danger' : status === 'expiring' ? 'warning' : ''}">${daysText ? daysText : 'Vence: ' + this.formatDateFull(p.expiryDate)}</div>` : ''}
                        ${p.barcode ? `<div class="product-meta" style="color: #999; font-size: 0.8rem;">🔎 ${p.barcode}</div>` : ''}
                        ${p.notes ? `<div class="product-meta" style="color: #999; font-size: 0.8rem;">📝 ${p.notes}</div>` : ''}
                    </div>
                    <button class="product-btn" onclick="event.stopPropagation(); app.consumeProduct(${p.id})">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            `;
        }).join('');
    }

    renderShoppingList() {
        const list = document.getElementById('shoppingList');
        const clearBtn = document.getElementById('clearShoppingBtn');

        if (this.shoppingList.length === 0) {
            list.innerHTML = '<p class="empty-state">Lista vacía</p>';
            clearBtn.style.display = 'none';
            return;
        }

        clearBtn.style.display = 'block';
        list.innerHTML = this.shoppingList.map(item => `
            <div class="shopping-item">
                <input type="checkbox" id="item-${item.id}" ${item.completed ? 'checked' : ''} onchange="app.toggleShoppingItem(${item.id}); app.renderShoppingList();">
                <label for="item-${item.id}">${item.name}</label>
                <button class="delete-btn" onclick="app.deleteShoppingItem(${item.id}); app.renderShoppingList();">
                    🗑️
                </button>
            </div>
        `).join('');
    }
}

// Initialize app
const app = new MiDespensa();
