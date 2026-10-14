/**
 * withAutofillHighlight — Config plugin de Expo (Android).
 *
 * Problema: al autocompletar credenciales, Android pinta el input con un
 * resaltado mostaza/amarillo (atributo de tema `android:autofilledHighlight`),
 * que se dibuja ENCIMA del input. No hay prop JS de React Native que lo controle.
 *
 * Fix: poner ese resaltado en transparente a nivel de tema, de modo que el input
 * conserve su color del theme (surface.card / text.primary) tras autocompletar.
 * NO desactiva el autofill — solo neutraliza el color del highlight.
 *
 * Nota: como el proyecto es Expo managed, esto se aplica en prebuild / build EAS
 * o dev build. NO es visible en Expo Go.
 */
const { withAndroidStyles } = require('@expo/config-plugins');

const ITEM_NAME = 'android:autofilledHighlight';
const ITEM_VALUE = '@android:color/transparent';

function setAutofillHighlight(styles) {
  const resources = styles.resources || (styles.resources = {});
  const stylesArr = resources.style || (resources.style = []);

  // Apunta al tema principal de la app; fallback al primer style declarado.
  let appTheme = stylesArr.find((s) => s.$ && s.$.name === 'AppTheme');
  if (!appTheme) appTheme = stylesArr[0];
  if (!appTheme) {
    appTheme = {
      $: { name: 'AppTheme', parent: 'Theme.AppCompat.Light.NoActionBar' },
      item: [],
    };
    stylesArr.push(appTheme);
  }
  if (!appTheme.item) appTheme.item = [];

  const existing = appTheme.item.find((i) => i.$ && i.$.name === ITEM_NAME);
  if (existing) {
    existing._ = ITEM_VALUE;
  } else {
    appTheme.item.push({ _: ITEM_VALUE, $: { name: ITEM_NAME } });
  }

  return styles;
}

const withAutofillHighlight = (config) =>
  withAndroidStyles(config, (cfg) => {
    cfg.modResults = setAutofillHighlight(cfg.modResults);
    return cfg;
  });

module.exports = withAutofillHighlight;
