# Cambios Recientes - MiDespensa (Junio 2026)

## 🎯 Objetivo
Reorganizar el flujo de entrada de productos para que se seleccionen del **catálogo maestro** en lugar de crear nuevos productos desde cero. Ahora los códigos de barras se agregan automáticamente al catálogo.

## ✨ Cambios Implementados

### 1. **Nuevo Flujo: "Agregar Producto"**

#### Antes:
- Hacía clic en "Agregar producto" → Abría formulario vacío
- Debía llenar todos los datos manualmente

#### Ahora:
- Hacía clic en "Agregar producto" → **Modal de búsqueda en catálogo**
- Puede **buscar productos existentes** en el catálogo maestro
- Al seleccionar uno, se **completa automáticamente** el formulario con:
  - Nombre del producto
  - Categoría
  - Código de barras
  - Marca (si existe)
  - Ubicación recomendada
- Todavía puede ajustar:
  - Cantidad
  - Unidad
  - Ubicación
  - Fecha de vencimiento (si es perecedero)
  - Notas adicionales

**Ventajas:**
✅ Más rápido agregar productos (no hay que escribir nombre)  
✅ Evita duplicados en el catálogo  
✅ Mantiene consistencia de datos  
✅ Mejor organización del inventario

### 2. **Escaneo de Código de Barras Mejorado**

#### Flujo anterior:
- Escanear → Buscar en OpenFoodFacts → Completar formulario de inventario

#### Nuevo flujo desde "Agregar Producto":
1. Haz clic en "Agregar producto"
2. En el modal de búsqueda, haz clic en "O escanear código" (botón verde)
3. Escanea el código de barras
4. El sistema:
   - **Busca en OpenFoodFacts**
   - **Agrega automáticamente al catálogo maestro** (si no existe)
   - Abre el formulario para **agregar al inventario**

#### Flujo en contexto de catálogo (sin cambios):
- La sección "Catálogo" tiene botón "Escanear"
- Funciona igual que antes: agrega al catálogo maestro

**Ventajas:**
✅ Los productos escaneados se guardan automáticamente en el catálogo  
✅ Próximas veces aparecerán en la búsqueda  
✅ Se agregan al catálogo ANTES que al inventario  
✅ Funciona incluso si OpenFoodFacts no encuentra el producto

### 3. **Categorización Automática**

Cuando escaneas un código o buscas en OpenFoodFacts:
- El sistema detecta automáticamente la **categoría correcta**
- Asigna la **ubicación recomendada**:
  - Lácteos, Bebidas, Frutas/Verduras, Carnes → **Frigo**
  - Congelados → **Congelador**
  - Despensa, Droguería → **Despensa**
- Marca como **"Perecedero"** si corresponde

## 🔍 Cómo Usar

### Agregar producto del catálogo:
1. En la pantalla inicial, haz clic en **"+ Agregar producto"**
2. Escribe el nombre del producto en la búsqueda
3. Usa los filtros (Lácteos, Bebidas, etc.) si lo prefieres
4. Haz clic en el producto para seleccionarlo
5. Ajusta cantidad, ubicación y fecha de vencimiento
6. Haz clic en "Guardar"

### Agregar producto escaneando código:
1. En la pantalla inicial, haz clic en **"+ Agregar producto"**
2. En el modal, haz clic en **"O escanear código"** (botón verde)
3. Apunta el código hacia la cámara
4. Espera a que se escanee automáticamente
5. Si se encuentra en OpenFoodFacts:
   - Se añade automáticamente al catálogo
   - Se abre el formulario para configurar la entrada al inventario
6. Haz clic en "Guardar"

### Agregar un producto completamente nuevo:
Si el producto no existe en el catálogo:
1. En "Agregar producto" → modal de búsqueda
2. Escribe el nombre y no encuentras nada
3. Presiona Enter o espera (si da opción de "crear nuevo")
4. O ve a la sección **"Catálogo"** → agrega manualmente
5. Luego aparecerá en la búsqueda para agregar al inventario

## 📊 Estructura de Datos

### Catálogo Maestro (shoppingList collection):
```
{
  id: "...",
  name: "Leche Desnatada",
  category: "dairy",
  barcode: "8410032012345",
  imageUrl: "https://...",
  metadata: {
    brand: "Lactalis",
    weight: "1l",
    unit: "litros"
  },
  inCart: false,
  completed: false
}
```

### Inventario (locations/{locationId}/products collection):
```
{
  firebaseId: "...",
  locationId: "R7voh6AbPw5SP5yNwU6R",
  name: "Leche Desnatada",
  category: "dairy",
  location: "fridge",
  quantity: 2,
  unit: "litros",
  barcode: "8410032012345",
  expiryDate: "2026-06-15",
  perishable: true,
  notes: "Marca: Lactalis",
  createdAt: {...}
}
```

## 🐛 Notas Técnicas

- **catalogSearchFilterType**: nueva variable para filtrar en el modal de búsqueda
- **fromCatalog**: flag para distinguir productos nuevos del catálogo vs. existentes
- **catalog-add**: nuevo contexto de escaneo para agregar desde "Agregar producto"
- **mapCategoryToLocation()**: mapea automáticamente categoría a ubicación recomendada
- **shouldBePerishable()**: determina si un producto debe marcarse como perecedero

## 🔄 Compatibilidad

✅ Todos los cambios son **backward compatible**  
✅ Los productos existentes en el inventario funcionan igual  
✅ La sección "Catálogo" mantiene su funcionalidad anterior  
✅ El escaneo desde "Catálogo" funciona igual que antes

## 📝 Archivos Modificados

- `index.html` - Modal nuevo de búsqueda de catálogo
- `js/app.js` - Lógica nueva de búsqueda y escaneo
- `css/styles.css` - Sin cambios (usa estilos existentes)
