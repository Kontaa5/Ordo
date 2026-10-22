// load errors before app.js runs (inline scripts are blocked by the CSP)
window.addEventListener('error', function (e) { try { window.webkit.messageHandlers.ordo.postMessage({ type: 'log', message: e.message + ' @ ' + e.filename + ':' + e.lineno + ':' + e.colno + ' ' + (e.error && e.error.stack || '') }); } catch (_) {} });
