# mejoratucvai-api

API de análisis de CVs con Gemini. Servicio stateless que recibe PDFs, extrae texto con `unpdf`, y devuelve análisis JSON generado por modelos Gemini en round-robin.

## Tabla de Variables de Entorno

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `PDF_API_SECRET` | Secret para autenticar requests (generar con `openssl rand -hex 32`) | `abc123...` |
| `GEMINI_API_KEY` | API Key de Google AI Studio (gratis, sin tarjeta) | `AIza...` |
| `ALLOWED_IP` | IP permitida (vacío = desarrollo local) | `192.168.1.100` |
| `MAX_PDF_SIZE_MB` | Tamaño máximo del PDF en MB | `10` |
| `PORT` | Puerto donde corre el servicio | `8000` |

## Setup Local

```bash
# Instalar dependencias
bun install

# Copiar y configurar variables
cp .env.example .env
# Editar .env con tus valores (ALLOWED_IP vacío en local)

# Ejecutar en desarrollo (hot reload)
bun dev

# O ejecutar en producción
bun start
```

Deberías ver:
```
✅ mejoratucvai-api corriendo en http://localhost:8000
```

## Tests Manuales

### Health Check (sin secret)
```bash
curl http://localhost:8000/health
```

### Analizar un PDF
```bash
curl -X POST http://localhost:8000/analyze \
  -H "X-API-Secret: tu_secret_aqui" \
  -F "file=@cv.pdf" \
  -F "market=PE" \
  -F "role=Desarrollador Senior"
```

## Round-Robin Gemini

El servicio rota entre modelos gratuitos para maximizar la cuota disponible:

| Modelo | RPM | RPD | Prioridad |
|--------|-----|-----|-----------|
| `gemini-2.5-flash-lite-preview-06-17` | 15 | 1,000 | 1 |
| `gemini-2.5-flash` | 10 | 250 | 2 |
| `gemini-2.5-pro` | 5 | 100 | 3 |

**Total aproximado: ~1,350 solicitudes/día gratis sin tarjeta**

El sistema implementa:
- Reset automático de contadores por minuto y por día
- Backoff exponencial tras errores 429
- Retry automático entre modelos

## Endpoints

### GET /health
Retorna el estado del servicio y disponibilidad de cada modelo Gemini.

### POST /analyze
Analiza un CV PDF.

**Headers:**
- `X-API-Secret`: Secret de autenticación

**FormData:**
- `file`: Archivo PDF (requerido)
- `market`: Mercado objetivo `PE|MX|CO|AR` (default: `PE`)
- `role`: Puesto al que aplica (opcional)

**Respuesta:**
```json
{
  "analysis": {
    "score": 85,
    "summary": "CV bien estructurado...",
    "sections": { ... },
    "top_issues": [...],
    "strengths": [...],
    "market_fit": "...",
    "ats_score": 78,
    "ats_tips": [...]
  },
  "meta": {
    "pages": 2,
    "words": 850,
    "chars": 5200,
    "model_used": "gemini-2.5-flash-lite-preview-06-17",
    "processing_ms": 3200
  }
}
```
