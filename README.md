[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

> Este proyecto está bajo la licencia AGPL v3. Si lo usas, modificas o despliegas
> como servicio, debes publicar el código fuente y dar crédito al proyecto original.

# mejoratucvai-api

API de análisis de CVs con Gemini. Servicio stateless que recibe PDFs, extrae texto con `unpdf`, y devuelve análisis JSON.

El servicio soporta 2 modos:

- **Round-robin interno** con la API key del servidor (`GEMINI_API_KEY`).
- **API key del usuario** (`user_api_key`) para ejecutar el análisis con su propia cuota.

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
  -F "role=Desarrollador Senior" \
  -F "user_api_key=AIza..."
```

## Modos de Gemini

### 1) Con API key del usuario (`user_api_key`)

- Se crea un cliente temporal con la key enviada.
- Se usa directamente el modelo `gemini-2.5-flash-lite` (sin round-robin).
- Manejo de errores:
  - 401/403 → `API key inválida o sin permisos`
  - 429 → `Tu API key alcanzó su límite de cuota`

### 2) Sin API key del usuario

Se usa el comportamiento de round-robin con la key del servidor.

## Round-Robin interno

El servicio rota entre modelos gratuitos para maximizar la cuota disponible:

| Modelo | RPM | RPD | Prioridad |
|--------|-----|-----|-----------|
| `gemini-2.5-flash-lite` | 10 | 20 | 1 |
| `gemini-2.5-flash` | 5 | 20 | 2 |
| `gemini-2.5-pro` | 5 | 20 | 3 |

**Total aproximado actual: ~60 solicitudes/día (según límites configurados en código).**

El sistema implementa:
- Reset automático de contadores por minuto y por día
- Backoff exponencial tras errores 429
- Retry automático entre modelos

## Calidad del análisis

El prompt de sistema usa una evaluación estricta para mejorar la calidad del feedback:

- Penaliza fuertemente CVs sin evidencia, sin métricas o con contenido genérico.
- Prioriza señales de empleabilidad real y legibilidad ATS.
- Obliga recomendaciones accionables y priorizadas por impacto.

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
- `user_api_key`: API key de Gemini del usuario (opcional)

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
