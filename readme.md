# Calcula BLKSIZE

Extensión para Visual Studio Code que calcula el BLKSIZE óptimo y propone
almacenamiento en cilindros para datasets MVS/z/OS.

## 🚀 Características

### 📊 Calculadora BLKSIZE

- ✅ Calcula BLKSIZE óptimo basado en LRECL y RECFM
- ✅ Propone almacenamiento en cilindros (CYL) con margen de seguridad
- ✅ Genera JCL listo para usar
- ✅ Interfaz visual integrada en VSCode
- ✅ Inserción rápida de BLKSIZE detectando automáticamente LRECL y RECFM

## 📖 Uso

### Método 1: Panel Visual

1. Presiona `Ctrl+Shift+P` (o `Cmd+Shift+P` en Mac)
2. Escribe "COBOL: Calcula BLKSIZE y espacio en cilindros"
3. Ingresa los parámetros en el panel
4. Obtén resultados completos y JCL generado

### Método 2: Inserción Rápida (Recomendado)

1. Selecciona dentro de tu JCL donde tienes declarado, por ejemplo:
   ```
   RECFM=FB,LRECL=537,BLKSIZE=)
   ```
2. Presiona `Ctrl+Alt+B` (o `Cmd+Alt+B` en Mac)
3. El valor del BLKSIZE se calculará e insertará automáticamente
4. Si falta RECFM, se te pedirá seleccionarlo

## ⌨️ Atajos de Teclado

- `Ctrl+Alt+B` / `Cmd+Alt+B`: Insertar/Calcular BLKSIZE

## 📋 Requisitos

- Visual Studio Code 1.60.0 o superior

## 🛠️ Instalación

1. Descarga el archivo `.vsix` desde las releases
2. En VS Code, ve a Extensiones → `...` → "Install from VSIX..."
3. Selecciona el archivo descargado

## 📝 Notas Técnicas

- **BLKSIZE**: Calculado para dispositivo 3390 (máximo: 27966)
- **Cilindros**: Se incluye RLSE para liberar espacio no utilizado
- **Primary/Secondary**: Calculados con distribución 80/20

## 👨‍💻 Desarrollado por

**Christian Castillo (CCASTI10)** - Versión 1.0.0

## 📄 Licencia

MIT
