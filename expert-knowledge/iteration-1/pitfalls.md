# Tier 5 Pitfalls — Iteration 1

## Accessing HTTP headers in Resource classes

To read request headers or set response headers from within a Resource
method, use `this.getContext()`:
```js
async get(target) {
  const context = this.getContext();
  const ifNoneMatch = context.headers.get('if-none-match');
  
  // Return 304 for conditional requests
  if (ifNoneMatch === currentETag) {
    return { status: 304, headers: { 'ETag': currentETag } };
  }
  
  // Normal response with ETag
  const data = await super.get(target);
  return { data, headers: { 'ETag': newETag } };
}
```

You can also set response headers via `context.responseHeaders.set()`.

## Don't skip caching requirements

The assignment asks for ETags, conditional requests (304), and cache
invalidation. These are hard requirements, not nice-to-haves. Verify
ALL pass criteria before running `gt done`.
