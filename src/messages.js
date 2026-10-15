// -----------------------------------------------------------------------------
// Texts sent from the container (action reports, connection status, errors),
// in the four languages of the Gladys interface. Entries are strings or
// functions of one parameter object. German says "du", Spanish "usted".
// -----------------------------------------------------------------------------

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

// Shown by Gladys under the integration name when it is not connected.
export const CONNECTION_TEXT = {
  noMonitor: {
    en: 'No AirGradient monitor found. Check that it is on the same network, or enter its IP address.',
    fr: "Aucun capteur AirGradient trouvé. Vérifiez qu'il est sur le même réseau, ou saisissez son adresse IP.",
    de: 'Kein AirGradient-Messgerät gefunden. Prüfe, ob es im selben Netzwerk ist, oder gib seine IP-Adresse ein.',
    es: 'No se ha encontrado ningún sensor AirGradient. Compruebe que está en la misma red o introduzca su dirección IP.',
  },
  noAnswer: {
    en: 'No AirGradient monitor answers.',
    fr: 'Aucun capteur AirGradient ne répond.',
    de: 'Kein AirGradient-Messgerät antwortet.',
    es: 'Ningún sensor AirGradient responde.',
  },
};

// Errors of a command, a setting, a scene action or a configuration action.
export const ERRORS = {
  en: {
    unknown: 'Unknown AirGradient monitor: search again from the integration configuration.',
    noAnswer: ({ name }) => `${name} does not answer.`,
    cloudOnly: ({ name }) =>
      `${name} only accepts settings from the AirGradient cloud: run "Use local settings" in the integration configuration.`,
    refused: ({ name, reason }) => `${name} refused the change (${reason}).`,
    notSupported: ({ name }) => `${name} does not have this setting.`,
    invalidValue: ({ value }) => `"${value}" is not a valid value.`,
    calibrationDisabled:
      'The CO₂ calibration is disabled: allow it in the integration configuration first.',
    noCo2: ({ name }) => `${name} has no CO₂ sensor.`,
  },
  fr: {
    unknown:
      "Capteur AirGradient inconnu : relancez la recherche depuis la configuration de l'intégration.",
    noAnswer: ({ name }) => `${name} ne répond pas.`,
    cloudOnly: ({ name }) =>
      `${name} n'accepte que les réglages du cloud AirGradient : lancez « Réglages locaux » dans la configuration de l'intégration.`,
    refused: ({ name, reason }) => `${name} a refusé le changement (${reason}).`,
    notSupported: ({ name }) => `${name} n'a pas ce réglage.`,
    invalidValue: ({ value }) => `« ${value} » n'est pas une valeur valide.`,
    calibrationDisabled:
      "La calibration du CO₂ est désactivée : autorisez-la d'abord dans la configuration de l'intégration.",
    noCo2: ({ name }) => `${name} n'a pas de capteur de CO₂.`,
  },
  de: {
    unknown:
      'Unbekanntes AirGradient-Messgerät: Starte die Suche in der Konfiguration der Integration erneut.',
    noAnswer: ({ name }) => `${name} antwortet nicht.`,
    cloudOnly: ({ name }) =>
      `${name} nimmt nur Einstellungen aus der AirGradient-Cloud an: Starte „Lokale Einstellungen“ in der Konfiguration der Integration.`,
    refused: ({ name, reason }) => `${name} hat die Änderung abgelehnt (${reason}).`,
    notSupported: ({ name }) => `${name} hat diese Einstellung nicht.`,
    invalidValue: ({ value }) => `„${value}“ ist kein gültiger Wert.`,
    calibrationDisabled:
      'Die CO₂-Kalibrierung ist deaktiviert: Erlaube sie zuerst in der Konfiguration der Integration.',
    noCo2: ({ name }) => `${name} hat keinen CO₂-Sensor.`,
  },
  es: {
    unknown:
      'Sensor AirGradient desconocido: vuelva a buscar desde la configuración de la integración.',
    noAnswer: ({ name }) => `${name} no responde.`,
    cloudOnly: ({ name }) =>
      `${name} solo acepta ajustes de la nube de AirGradient: ejecute «Ajustes locales» en la configuración de la integración.`,
    refused: ({ name, reason }) => `${name} ha rechazado el cambio (${reason}).`,
    notSupported: ({ name }) => `${name} no tiene este ajuste.`,
    invalidValue: ({ value }) => `«${value}» no es un valor válido.`,
    calibrationDisabled:
      'La calibración del CO₂ está desactivada: autorícela primero en la configuración de la integración.',
    noCo2: ({ name }) => `${name} no tiene sensor de CO₂.`,
  },
};

// Reports of the configuration actions.
export const REPORTS = {
  en: {
    none: 'No AirGradient monitor found.',
    count: ({ total, reachable }) => `${total} monitor(s), ${reachable} answering:`,
    unreachable: 'not answering',
    noMdns: 'Automatic discovery (mDNS) through Gladys is unavailable: enter the IP addresses.',
    ignored: ({ list }) => `Ignored addresses: ${list}.`,
    toDiscovery: 'Open the Discover tab to add the new ones.',
    localDone: ({ name }) =>
      `${name} now takes its settings from the local network only: changes made on the AirGradient dashboard no longer apply.`,
    localAlready: ({ name }) => `${name} already takes its settings from the local network only.`,
  },
  fr: {
    none: 'Aucun capteur AirGradient trouvé.',
    count: ({ total, reachable }) => `${total} capteur(s), ${reachable} répondent :`,
    unreachable: 'ne répond pas',
    noMdns:
      'La découverte automatique (mDNS) par Gladys est indisponible : saisissez les adresses IP.',
    ignored: ({ list }) => `Adresses ignorées : ${list}.`,
    toDiscovery: "Ouvrez l'onglet Découverte pour ajouter les nouveaux.",
    localDone: ({ name }) =>
      `${name} ne prend plus ses réglages que du réseau local : ceux du tableau de bord AirGradient ne s'appliquent plus.`,
    localAlready: ({ name }) => `${name} ne prend déjà ses réglages que du réseau local.`,
  },
  de: {
    none: 'Kein AirGradient-Messgerät gefunden.',
    count: ({ total, reachable }) => `${total} Messgerät(e), davon ${reachable} erreichbar:`,
    unreachable: 'antwortet nicht',
    noMdns:
      'Die automatische Erkennung (mDNS) über Gladys ist nicht verfügbar: Gib die IP-Adressen ein.',
    ignored: ({ list }) => `Ignorierte Adressen: ${list}.`,
    toDiscovery: 'Öffne den Tab „Entdecken“, um die neuen hinzuzufügen.',
    localDone: ({ name }) =>
      `${name} nimmt Einstellungen jetzt nur noch aus dem lokalen Netzwerk an: Änderungen im AirGradient-Dashboard gelten nicht mehr.`,
    localAlready: ({ name }) =>
      `${name} nimmt Einstellungen schon nur aus dem lokalen Netzwerk an.`,
  },
  es: {
    none: 'No se ha encontrado ningún sensor AirGradient.',
    count: ({ total, reachable }) => `${total} sensor(es), ${reachable} responden:`,
    unreachable: 'no responde',
    noMdns:
      'El descubrimiento automático (mDNS) a través de Gladys no está disponible: introduzca las direcciones IP.',
    ignored: ({ list }) => `Direcciones ignoradas: ${list}.`,
    toDiscovery: 'Abra la pestaña Descubrir para añadir los nuevos.',
    localDone: ({ name }) =>
      `${name} solo acepta ahora los ajustes de la red local: los cambios del panel de AirGradient ya no se aplican.`,
    localAlready: ({ name }) => `${name} ya solo acepta los ajustes de la red local.`,
  },
};

/** One entry of a table, in every language: `{ en, fr, de, es }`. */
export function render(table, key, params = {}) {
  return Object.fromEntries(
    Object.entries(table).map(([language, entries]) => {
      const entry = entries[key];
      return [language, typeof entry === 'function' ? entry(params) : entry];
    }),
  );
}

/** Several multi-language texts, joined by a space in each language. */
export function join(...texts) {
  return Object.fromEntries(
    Object.keys(texts[0]).map((language) => [
      language,
      texts.map((text) => text[language]).join(' '),
    ]),
  );
}

export class GladysError extends Error {
  /** An error whose message is a multi-language object (shown in Gladys). */
  constructor(messages, language = 'en') {
    super(messages[language] ?? messages.en);
    this.messages = messages;
  }
}
