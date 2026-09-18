# QR Backend (ejemplo)

Servidor minimal en Node/Express para recibir códigos QR enviados por el frontend.

Endpoints:
- `POST /qr` — recibe JSON `{ code, timestamp? }` y guarda en `codes.log.json`.
- `GET /logs` — devuelve el arreglo de entradas guardadas.

Run:

```bash
cd backend
npm install
npm start
```
