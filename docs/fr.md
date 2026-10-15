# AirGradient

Cette intégration amène dans Gladys les capteurs de qualité de l'air **AirGradient** : l'AirGradient
ONE (intérieur), l'Open Air (extérieur), les kits DIY et l'AirGradient Go. Elle les lit sur votre
réseau local, par l'API locale de leur firmware : ni compte, ni cloud, ni clé d'API.

> **Développée sans le matériel : vos retours sont les bienvenus.** L'intégration a été écrite à
> partir du code source du firmware AirGradient, de la documentation de son API locale et des
> vraies réponses publiées avec la bibliothèque Python `airgradient` et l'intégration Home
> Assistant. Elle n'a pas encore été essayée sur un vrai capteur : dites-nous sur le forum Gladys
> ce qui marche et ce qui ne marche pas.

Cette intégration n'est pas affiliée à AirGradient.

## Ce que vous obtenez

- **Un appareil par capteur**, trouvé automatiquement sur votre réseau (mDNS), ou ajouté par son
  adresse IP.
- Ses mesures, rafraîchies chaque minute : **PM1, PM2,5, PM10, CO₂, température, humidité, indice
  COV, indice NOx, nombre de particules de 0,3 µm, signal Wi-Fi** (et la batterie du Go). Seulement
  ce que mesure votre modèle : un Open Air sans capteur de CO₂ n'a pas de fonctionnalité CO₂.
- Les **valeurs corrigées** quand le firmware les fournit (PM2,5 avec la correction EPA,
  température et humidité de l'Open Air) : ce sont celles qu'affiche le capteur.
- En option, les **réglages du capteur** depuis Gladys : luminosité de l'écran, luminosité de la
  barre LED, mode de la barre LED et unité de température de l'écran (AirGradient ONE, kits DIY).
- Un **widget « Qualité de l'air »** pour le tableau de bord : les mesures en direct et la qualité
  de l'air en couleur.
- Un **déclencheur de scène** quand un capteur ne répond plus, et une **action de scène** pour
  calibrer le capteur de CO₂ (désactivée par défaut).

## Prérequis

- Gladys Assistant **5.1.0** ou plus récent.
- Un capteur AirGradient en firmware **3.1** ou plus récent (3.0.10 pour l'API locale, 3.1.4 pour
  le PM2,5 corrigé), connecté au même réseau que Gladys, ou à un réseau que Gladys peut joindre.
- Rien d'autre : l'API locale ne demande pas de mot de passe.

Pour trouver l'adresse IP d'un capteur : la liste des appareils connectés de votre box (le capteur
s'appelle `airgradient_<numéro de série>`), ou le tableau de bord AirGradient, dans le détail du
capteur.

## Configuration

Installez l'intégration depuis **Intégrations → Installer depuis le store** (ou **Installer depuis
GitHub**), puis ouvrez son onglet **Configuration**.

### Réglages

| Réglage                              | Par défaut | Ce qu'il fait                                                                                                     |
| ------------------------------------ | ---------- | ----------------------------------------------------------------------------------------------------------------- |
| Adresses IP des capteurs             | vide       | Facultatif. Les adresses que la découverte automatique ne trouve pas, séparées par des virgules (`192.168.1.50`). |
| Fréquence de lecture                 | 1 minute   | Fréquence de lecture de chaque capteur : 30 secondes, 1, 2 ou 5 minutes.                                          |
| Réglages des capteurs depuis Gladys  | Non        | Ajoute aux appareils les réglages de l'écran et de la barre LED (voir plus bas).                                  |
| Calibration du CO₂ depuis les scènes | Interdite  | Autorise l'action de scène « Calibrer le capteur de CO₂ ».                                                        |
| Langue des noms de fonctionnalités   | Français   | Noms donnés aux fonctionnalités des nouveaux appareils.                                                           |

### Trouver les capteurs

Les capteurs s'annoncent sur le réseau (mDNS, service `_airgradient._tcp`). L'intégration tourne
dans un conteneur qui n'entend pas ces annonces : Gladys les écoute pour elle et les lui transmet.
Ouvrez l'onglet **Découverte**, puis ajoutez les capteurs voulus.

S'il manque un capteur (autre réseau, VLAN, mDNS filtré par la box), saisissez son adresse IP dans
**Adresses IP des capteurs**. Le bouton **Rechercher les capteurs** relance la recherche et liste ce
qu'il a trouvé. Un capteur qui change d'adresse (DHCP) est suivi par son numéro de série : son
appareil reste le même. Lui donner une adresse fixe dans votre box reste le plus sûr.

### Réglages des capteurs depuis Gladys

Avec **Réglages des capteurs depuis Gladys** sur **Oui**, les appareils de l'AirGradient ONE et des
kits DIY reçoivent des fonctionnalités en plus :

- **Luminosité de l'écran** et **Luminosité de la barre LED** (0 à 100 %, la barre LED sur le ONE
  seulement) ;
- **Mode de la barre LED** : éteinte, CO₂ ou PM2,5 (ONE seulement) ;
- **Unité de température de l'écran** : °C ou °F, pour l'écran du capteur seulement — Gladys reçoit
  toujours la température en °C et l'affiche dans votre unité.

Après avoir changé ce réglage, cliquez sur **Mettre à jour** sur le capteur dans l'onglet
**Découverte**.

Un capteur configuré sur le tableau de bord AirGradient peut ne prendre ses réglages que du cloud.
Gladys ne peut alors pas les changer : lancez **Réglages locaux** dans l'onglet Configuration et
choisissez le capteur. Dès lors, le capteur ne prend plus ses réglages que du réseau local, et ceux
du tableau de bord AirGradient ne s'appliquent plus à lui.

## Appareils

Chaque capteur est un appareil nommé d'après son modèle et la fin de son numéro de série (par
exemple « AirGradient ONE 12f5 ») : renommez-le à votre guise.

| Fonctionnalité    | Unité         | Remarques                                                                     |
| ----------------- | ------------- | ----------------------------------------------------------------------------- |
| PM1               | µg/m³         | Gladys n'a pas de catégorie PM1 : il s'affiche avec l'icône du PM2,5.         |
| PM2,5             | µg/m³         | Valeur corrigée quand le firmware la fournit.                                 |
| PM10              | µg/m³         |                                                                               |
| CO₂               | ppm           | ONE, Open Air avec capteur de CO₂, Go, la plupart des kits DIY.               |
| Température       | °C            | Valeur corrigée sur l'Open Air.                                               |
| Humidité          | %             | Valeur corrigée sur l'Open Air.                                               |
| Indice COV        | 1 à 500       | Indice Sensirion : 100 est la moyenne du dernier jour, au-delà c'est pire.    |
| Indice NOx        | 1 à 500       | Indice Sensirion : 1 est le niveau normal, au-delà il y a des oxydes d'azote. |
| Particules 0,3 µm | par décilitre | Comptage brut du capteur de particules.                                       |
| Batterie          | %             | AirGradient Go seulement.                                                     |
| Signal Wi-Fi      | dBm           | -30 est excellent, -80 est faible.                                            |

Les valeurs sont arrondies (température au dixième de degré, humidité au pour cent, particules au
dixième de µg/m³) et envoyées à Gladys seulement quand elles changent ; une valeur stable est
renvoyée toutes les 12 heures. L'appareil affiche un badge « local », ou « injoignable » quand le
capteur ne répond pas.

## Widget du tableau de bord

Ajoutez le widget **Qualité de l'air** (AirGradient) à un tableau de bord et choisissez un capteur
dans ses réglages. Il affiche le CO₂, le PM2,5, la température et l'humidité en direct, et un état
en couleur :

| Niveau        | CO₂ (ppm)       | PM2,5 (µg/m³) |
| ------------- | --------------- | ------------- |
| Bonne         | jusqu'à 800     | jusqu'à 9     |
| Moyenne       | jusqu'à 1000    | jusqu'à 35    |
| Mauvaise      | jusqu'à 1500    | jusqu'à 55    |
| Très mauvaise | au-delà de 1500 | au-delà de 55 |

Ce sont les couleurs de la barre LED AirGradient (pour le PM2,5, les seuils de l'EPA américaine ;
la valeur guide de l'OMS sur 24 heures, 15 µg/m³, est dans la tranche « moyenne »). La qualité de
l'air globale est la pire des deux.

## Déclencheur de scène

**Capteur AirGradient muet** : un capteur ne répond plus (trois lectures de suite, trois minutes
avec la fréquence par défaut). Filtrez sur un capteur, ou laissez vide pour n'importe lequel.
Variables : le nom du capteur et son adresse IP. Il se déclenche une fois, quand le capteur est
perdu ; ses dernières valeurs restent dans Gladys.

Il n'y a pas de déclencheur « CO₂ au-dessus de 1000 » : utilisez le déclencheur d'appareil habituel
de Gladys sur la fonctionnalité CO₂, avec votre propre seuil.

## Action de scène

**Calibrer le capteur de CO₂ AirGradient** : le capteur prend sa mesure actuelle pour 400 ppm, le
niveau de l'air extérieur frais. Elle est refusée tant que **Calibration du CO₂ depuis les scènes**
n'est pas sur **Autorisée**. Ne la lancez qu'avec le capteur dehors (ou devant une fenêtre grande
ouverte) depuis plusieurs minutes : à l'intérieur, toutes les mesures suivantes seraient trop
basses. Le capteur de CO₂ se recalibre aussi tout seul sur quelques jours (calibration automatique
de la ligne de base) : la plupart des utilisateurs n'ont jamais besoin de cette action.

## Exemples de scènes

- **Aérer la chambre** : quand le CO₂ de la chambre dépasse 1200 ppm, envoyer le message « Ouvre la
  fenêtre » — et quand il repasse sous 800 ppm, « Tu peux la fermer ».
- **Fumées ou pollution** : quand le PM2,5 de l'Open Air dépasse 35 µg/m³, fermer les volets et
  allumer le purificateur d'air.
- **Capteur perdu** : avec le déclencheur « Capteur AirGradient muet », envoyer un message avec
  `{{triggerEvent.data.name}}` et son adresse.
- **Mode nuit** (avec les réglages) : à 22 h, mettre la luminosité de l'écran et de la barre LED du
  ONE à 0 ; à 7 h, les remettre à 80.

## Dépannage

- **Aucun capteur dans l'onglet Découverte** : vérifiez que le capteur est connecté au Wi-Fi (son
  écran affiche les mesures, pas un message de configuration), puis saisissez son adresse IP dans
  **Adresses IP des capteurs** et cliquez sur **Rechercher les capteurs**. Le compte rendu dit si la
  découverte automatique est disponible.
- **« ne répond pas »** : le capteur est éteint, hors de portée du Wi-Fi, ou a une nouvelle adresse.
  Ouvrez `http://<adresse IP>/measures/current` dans un navigateur du même réseau : les mesures
  doivent s'afficher en JSON. Un firmware antérieur à 3.0.10 n'a pas d'API locale : mettez-le à
  jour depuis le capteur.
- **Un réglage est refusé, « n'accepte que les réglages du cloud AirGradient »** : lancez
  **Réglages locaux**.
- **Une valeur manque juste après un redémarrage du capteur** : les capteurs ont besoin d'une
  minute au plus avant leur première mesure ; la valeur arrive au rafraîchissement suivant.
- **Journaux** : la page Supervision de Gladys affiche les journaux de l'intégration. Ils sont
  volontairement calmes : une ligne quand un capteur est trouvé, perdu ou de retour, et une par
  action. Mettez la variable `LOG_LEVEL=debug` pour voir chaque lecture.

## Limites

- L'intégration ne lit que l'**API locale**. L'API cloud d'AirGradient (avec jeton) n'est pas prise
  en charge : un capteur doit être joignable depuis Gladys sur le réseau.
- L'API locale n'a pas de mot de passe : n'importe qui sur votre réseau peut lire un capteur, et
  changer ses réglages s'il accepte les réglages locaux. C'est le fonctionnement du firmware.
- Les réglages de l'**AirGradient Go** (API plus récente) et de l'**Open Air** (sans écran) ne sont
  pas proposés ; leurs mesures, si.
- Les indices COV et NOx s'affichent avec la catégorie « Indice COV Sensirion » : Gladys n'a pas de
  catégorie NOx. Le PM1 utilise la catégorie PM2,5.
- Les mesures sont des moyennes calculées par le capteur ; lire plus souvent que toutes les
  30 secondes ne ferait que les répéter. L'API locale n'a pas de quota, mais le capteur est un petit
  appareil : une lecture par minute, c'est aussi ce que fait Home Assistant.
- Les réglages changés depuis le tableau de bord AirGradient ne sont vus par Gladys qu'à la lecture
  suivante.
