# /sw.js requests

Current source, built assets inspected before the change, and tracked sw.js history contain no registration for /sw.js. No service worker is intended. An existing browser registration can still perform update requests after its registering code is removed. The layout now unregisters only same-origin /sw.js workers; it does not create an empty worker, clear auth storage, or delete unrelated caches.

Verify in the affected browser's Application → Service Workers and the Network initiator column. Reload after unregistering and confirm no subsequent update request. A first navigation may already have started an old update request before cleanup runs. If there is no registration, inspect extensions and external injectors; repository inspection cannot establish the initiator of a request from an unavailable browser session.
