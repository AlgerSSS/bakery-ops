async function run() {
  console.log('=== KDocs API 测试 ===');
  try {
    const res = await fetch('https://www.kdocs.cn/api/v3/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: 'SX20260505QAMOIL',
        app_secret: 'qYTHBLaPWMhBzQuHoDIrLXPoplumMVqV',
        grant_type: 'client_credentials',
      }),
    });
    console.log('Status:', res.status);
    const text = await res.text();
    console.log('Response:', text.slice(0, 500));
  } catch (err) {
    console.log('Network error:', String(err));
  }
}

run();
