// Public links, used when the pwa_url and staff_url settings are blank. The staff link still needs a UiTM
// sign-in and a row in the Staff tab.
const APP_URLS = {
  pwa: 'https://mathsyafiq.github.io/food-bank-uitmcpp/',
  staff: 'https://script.google.com/macros/s/AKfycbyDrHlZgISTgVhhI35MW-KOwnAXkks10Wj-9AZJ77ahIYO5EViH4ahiR2IYZ6nBTcsj/exec',
};

// Addresses the student app had before. A pwa_url setting that still starts with one of these is treated as
// blank, so posters and the Devices page follow APP_URLS.pwa.
const OLD_PWA_URLS = ['https://mathsyafiq.github.io/food-bank-urhp'];
