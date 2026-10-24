import base from './playwright.p13b2.config';
export default { ...base, use: { ...base.use, launchOptions: { executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' } } };
