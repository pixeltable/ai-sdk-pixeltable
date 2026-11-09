# @pixeltable/ai-sdk

Vercel AI SDK tools for [Pixeltable](https://pixeltable.com) embedding-index search and table queries.

Pixeltable apps expose HTTP routes with `pxt service update` (local or [Pixeltable Cloud](https://docs.pixeltable.com/cloud)). This package is a thin, server-side `fetch` client for those routes.

Pass `pixeltableTools()` to `generateText` or `streamText`. The model can search an embedding index and query tables through whatever query routes your `app.py` defines.

This package is for Node and other server runtimes. Keep `PIXELTABLE_API_KEY` on the server, never in browser code.

## Install

```bash
npm install @pixeltable/ai-sdk
```

Peer dependencies: `ai` ^5 || ^6 || ^7 and `zod` ^3.25 || ^4, Node.js 18+.

```bash
npm install @pixeltable/ai-sdk ai zod
```

## Configure the service

| Variable                 | Required                       | Purpose                                                                                                                                                                                               |
| ------------------------ | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PIXELTABLE_SERVICE_URL` | Yes, unless you pass `baseUrl` | Full service endpoint from `pxt service list` or the Cloud dashboard. Local example: `http://127.0.0.1:54140`. Cloud hosts look like `https://{org}-{db}.svc.pxt.run/`. Do not hardcode the hostname. |
| `PIXELTABLE_API_KEY`     | Cloud only                     | Sent as `X-api-key`. Local `pxt service` typically needs no key.                                                                                                                                      |

```bash
export PIXELTABLE_SERVICE_URL='https://your-org-main.svc.pxt.run'
export PIXELTABLE_API_KEY='your-key'   # Cloud only
```

You can pass the same values to the factory instead of using the environment:

```ts
pixeltableTools({
  baseUrl: process.env.PIXELTABLE_SERVICE_URL,
  apiKey: process.env.PIXELTABLE_API_KEY,
});
```

If a request also sends `Authorization: Bearer`, Cloud still authenticates the API key. This package sends `X-api-key` only, and only when a key is set.

## Usage

```ts
import { generateText, isStepCount } from 'ai';
import { pixeltableTools } from '@pixeltable/ai-sdk';

const { text } = await generateText({
  model: 'openai/gpt-5-mini',
  prompt: 'Search the knowledge base for our refund policy and quote the matching rows.',
  tools: pixeltableTools(),
  stopWhen: isStepCount(5),
});
```

Or pick tools:

```ts
import { pixeltableQuery, pixeltableSearch } from '@pixeltable/ai-sdk';

const tools = {
  search: pixeltableSearch({ searchPath: '/search' }),
  query: pixeltableQuery({ queryPath: '/lookup' }),
};
```

## Tools

`pixeltableTools()` returns:

| Key          | Factory                  | What it does                                                                                                                                                                              |
| ------------ | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search`     | `pixeltableSearch()`     | Search an embedding index through a query HTTP route. Default: `POST /search` with `{ "query_text": "..." }`.                                                                             |
| `query`      | `pixeltableQuery()`      | Call any query route your app exposes (`add_query_route`). Pass `path` and JSON `arguments`.                                                                                              |
| `listRoutes` | `pixeltableListRoutes()` | `GET /openapi.json` and list query/search routes (operationIds starting with `query_`, plus search-like paths). Insert, update, delete, compute, health, and job-poll routes are omitted. |

v0.1 is read-only. It does not insert, update, or delete rows.

### Search

The documented Pixeltable RAG pattern is:

```bash
curl -X POST "$PIXELTABLE_SERVICE_URL/search" \
  -H 'Content-Type: application/json' \
  -d '{"query_text": "handbook"}'
```

The search tool does the same. Tool input:

- `query` (required): search string
- `path` (optional): override the route, default `/search` or `searchPath`
- `limit` (optional): sent as `limit` when your `@pxt.query` declares that parameter
- `arguments` (optional): extra JSON fields the query function accepts

If your query uses a different parameter name (`query` instead of `query_text`):

```ts
pixeltableTools({ searchQueryParameter: 'query' });
```

### Query

There is no universal `/query` path. Each `@pxt.query` you register with `add_query_route` becomes its own route. The query tool calls that path with a JSON body (POST, the Pixeltable default) or query-string parameters (`method: 'GET'`).

Typical responses from Pixeltable query routes:

- Several rows: `{ "rows": [{ ... }, ...] }`
- A list of scalar values: `[...]`
- One row: a JSON object, or HTTP 404 with `"detail": "query returned no rows"`
- One scalar: the value itself

### Discover routes

Download the service schema the same way a TypeScript app server would:

```bash
curl -fsS -H "X-api-key: $PIXELTABLE_API_KEY" "${PIXELTABLE_SERVICE_URL%/}/openapi.json"
```

Local services omit the header. Interactive docs are at `/docs`. The `listRoutes` tool wraps that OpenAPI document so the model can find search and query paths.

## Your app.py must expose HTTP query routes

Search and query only work if your Pixeltable application serves those routes. See [HTTP serving](https://docs.pixeltable.com/howto/deployment/serving).

Minimal RAG service:

```python
import pixeltable as pxt
import pixeltable.functions as pxtf
from pixeltable.serving import FastAPIRouter

TableModel = pxt.model_base()
embed = pxtf.huggingface.sentence_transformer.using(
    model_id='sentence-transformers/all-MiniLM-L6-v2'
)

class Docs(TableModel, name='docs'):
    document: pxt.Document

class Chunks(
    TableModel,
    name='chunks',
    base=Docs,
    iterator=pxtf.document.document_splitter(
        Docs.document, separators='token_limit', limit=300
    ),
):
    __indexes__ = [
        pxt.EmbeddingIndex(text, embedding=embed, name='chunks_embed')
    ]

@pxt.query
def search_docs(query_text: str):
    sim = Chunks.text.similarity(string=query_text)
    return Chunks.order_by(sim, asc=False).limit(10).select(Chunks.text, sim)

@pxt.query
def lookup_chunk(pos: int):
    return Chunks.where(Chunks.pos == pos).limit(1)

api = FastAPIRouter(name='rag')
api.add_query_route(path='/search', query=search_docs, method='post')
api.add_query_route(path='/lookup', query=lookup_chunk, method='post')
```

Then:

```bash
pxt schema update app.py my_app
pxt service update app.py my_app
pxt service list my_app --json   # copy the endpoint into PIXELTABLE_SERVICE_URL
```

On Cloud, use the same `app.py` with `pxt://org:main` and send `X-api-key`. Details: [Pixeltable Cloud](https://docs.pixeltable.com/cloud) and the [quickstart](https://docs.pixeltable.com/overview/quick-start).

## Errors

Failed requests throw `PixeltableError`. Pixeltable runtime errors and Cloud gateway errors use:

```json
{
  "detail": {
    "error_code": "JOB_REFUSED",
    "message": "...",
    "retryable": true,
    "retry_after": 5
  }
}
```

`detail` is a string for a missing row (`query returned no rows`) and an array for request-validation errors. Branch on the shape of `detail`, not only the status.

Cloud gateway cases:

| Status | Typical meaning                |
| ------ | ------------------------------ |
| 401    | Missing or invalid API key     |
| 403    | Key cannot access this service |
| 404    | Unknown service or route       |
| 429    | Key is rate limited            |
| 503    | Service is not running         |

`PixeltableError` exposes `status`, `errorCode`, `retryable`, `retryAfter`, and `detail`. Messages are redacted so API keys are not written to logs.

Retry a write only when `retryable` is true, after `retryAfter` seconds when present. This package's tools are read-only.

## Factory options

```ts
pixeltableTools({
  baseUrl: 'http://127.0.0.1:54140', // PIXELTABLE_SERVICE_URL
  apiKey: '...', // PIXELTABLE_API_KEY; omit locally
  searchPath: '/search',
  searchQueryParameter: 'query_text',
  queryPath: '/lookup', // optional default for the query tool
  timeoutMs: 30_000,
});
```

## Development

```bash
npm install
npm test
npm run typecheck
npm run lint
npm run build
```

Tests mock `fetch`. They do not call Pixeltable Cloud or require API keys.

## License

Apache-2.0
