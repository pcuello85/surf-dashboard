const { test, expect } = require('@playwright/test');
const path = require('path');

// Horas "YYYY-MM-DDTHH:00" para 18 días empezando 2 días atrás (cubre past_days de la calibración)
function hourlyTimes() {
  const times = [];
  const start = new Date(Date.now() - 2 * 24 * 3600 * 1000);
  start.setUTCHours(0, 0, 0, 0);
  for (let d = 0; d < 18; d++) {
    for (let h = 0; h < 24; h++) {
      const t = new Date(start.getTime() + (d * 24 + h) * 3600 * 1000);
      times.push(t.toISOString().slice(0, 13) + ':00');
    }
  }
  return times;
}

function marinePayload() {
  const time = hourlyTimes();
  const n = () => time.map(() => 1.4);
  return {
    hourly: {
      time,
      wave_height: n(),
      wave_period: time.map(() => 12),
      wave_direction: time.map(() => 20),
      swell_wave_height: time.map(() => 1.2),
      swell_wave_period: time.map(() => 13),
      swell_wave_direction: time.map(() => 20),
      wind_wave_height: time.map(() => 0.3),
    },
  };
}
function windPayload() {
  const time = hourlyTimes();
  return {
    hourly: {
      time,
      wind_speed_10m: time.map(() => 10),
      wind_direction_10m: time.map(() => 190),
    },
  };
}

async function setupPage(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/marine-api.open-meteo.com/**', (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify(marinePayload()) })
  );
  await page.route('**/api.open-meteo.com/**', (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify(windPayload()) })
  );
  await page.route('**/api.swellcloud.net/**', (r) => r.abort());
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  return errors;
}

test('carga sin errores JS y con day-cards', async ({ page }) => {
  const errors = await setupPage(page);
  await page.waitForSelector('#forecastStrip .day-card', { timeout: 15000 });
  expect(errors).toEqual([]);
});

test('11 spots DO (incluye El Canal), 7 NI', async ({ page }) => {
  await setupPage(page);
  await page.waitForSelector('#spotGrid .spot-btn');
  expect(await page.locator('#spotGrid .spot-btn').count()).toBe(11);
  await expect(page.locator('#spotGrid .spot-btn', { hasText: 'El Canal' })).toHaveCount(1);
  await page.locator('#countryGrid .country-btn', { hasText: 'Nicaragua' }).click();
  await page.waitForSelector('#forecastStrip .day-card');
  expect(await page.locator('#spotGrid .spot-btn').count()).toBe(7);
});

test('la fuerza/condición pinta chips con FONDO de color en cada spot', async ({ page }) => {
  await setupPage(page);
  await page.waitForSelector('#spotGrid .spot-btn');
  // espera a que paintSpotEnergy llene los badges
  await page.waitForFunction(() => {
    const chips = document.querySelectorAll('#spotGrid [data-energy] span');
    return chips.length >= 5;
  }, { timeout: 20000 });
  const bgs = await page.$$eval('#spotGrid [data-energy] span', (els) =>
    els.map((el) => getComputedStyle(el).backgroundColor)
  );
  const colored = bgs.filter((b) => b && b !== 'rgba(0, 0, 0, 0)' && b !== 'rgb(255, 255, 255)');
  expect(colored.length).toBeGreaterThanOrEqual(5); // chips con fondo de color
  // y un 🏆 marca el mejor spot con fondo sólido
  await expect(page.locator('#spotGrid .crown')).toHaveCount(1);
});

test('colores funcionan SIN red externa (CSS incrustado, sin CDN)', async ({ page }) => {
  await page.route('**/*', (r) => {
    const u = r.request().url();
    if (u.startsWith('file://')) return r.continue();
    if (u.includes('marine-api.open-meteo.com')) return r.fulfill({ contentType: 'application/json', body: JSON.stringify(marinePayload()) });
    if (u.includes('api.open-meteo.com')) return r.fulfill({ contentType: 'application/json', body: JSON.stringify(windPayload()) });
    return r.abort();
  });
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await page.waitForSelector('#forecastStrip .day-card');
  const radius = await page.locator('#forecastStrip .day-card').first().evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
  expect(parseFloat(radius)).toBeGreaterThan(0); // Tailwind activo sin red
  const html = await page.content();
  expect(html).not.toContain('cdn.tailwindcss.com');
});

test('fallo total de forecast no rompe la página', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/marine-api.open-meteo.com/**', (r) => r.abort());
  await page.route('**/api.open-meteo.com/**', (r) => r.abort());
  await page.route('**/api.swellcloud.net/**', (r) => r.abort());
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await page.waitForTimeout(3000);
  // la UI principal sigue viva (ranking de tablas con sliders manuales)
  expect(await page.locator('#rankings .board-card').count()).toBeGreaterThanOrEqual(3);
  expect(errors).toEqual([]);
});
