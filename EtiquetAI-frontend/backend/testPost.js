(async () => {
  try {
    const res = await fetch('http://localhost:4000/qr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'TEST-CLI', timestamp: new Date().toISOString() })
    });
    const json = await res.json();
    console.log('Response status:', res.status);
    console.log(JSON.stringify(json, null, 2));
  } catch (e) {
    console.error('Request failed:', e);
    process.exit(1);
  }
})();
