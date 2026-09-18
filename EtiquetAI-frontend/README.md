# QR Frontend

Pequeña aplicación frontend para escanear códigos QR desde la cámara del navegador y registrar los valores detectados.

Pasos rápidos:

1. Instalar dependencias:

```bash
npm install
```

2. Compilar TypeScript:

```bash
npm run build
```

3. Abrir `index.html` en el navegador o ejecutar:

```bash
npm start
```

Notas:
- Usa la librería `jsQR` cargada por CDN en `index.html`.
- Las clases abstractas están en `src/abstracts` y las implementaciones en `src/implementations`.
