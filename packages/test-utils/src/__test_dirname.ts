console.log('dirname:', (await import('node:url')).fileURLToPath(new URL('.', import.meta.url))); console.log('meta.dirname:', import.meta.dirname ?? 'UNDEFINED');
