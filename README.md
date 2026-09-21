# Atag Lydos voor Homey

Bedien je **Atag Lydos Hybrid** warmtepompboiler vanuit Homey: temperatuur instellen, modus kiezen, aan- en uitzetten, en meekijken hoe warm het water is.

> **Status:** in test. De app is nog niet gecertificeerd voor de Homey App Store — installeren gaat via de testversie hieronder. Werkt hij bij jou? Laat het weten in de [issues](https://github.com/WNijhof/homey-atag-lydos/issues), dat helpt om hem door de certificering te krijgen.

## Installeren

1. Zorg dat je boiler via wifi verbonden is en werkt in de **Atag-app**. Deze app praat met dezelfde cloud.
2. Installeer de testversie: **[homey.app/a/com.drpeppers.ataglydos/test](https://homey.app/a/com.drpeppers.ataglydos/test/)**
3. In de Homey-app: **Apparaten → + → Atag Lydos → Lydos Hybrid**
4. Log in met je **Atag-gegevens** — hetzelfde e-mailadres en wachtwoord als in de Atag-app.

Werkt op **Homey Pro** (2019 en 2023) en de **Homey Self-Hosted Server**. Op Homey Cloud met een Bridge kun je geen testversies installeren.

## Wat de app kan

| | |
|---|---|
| **Instellen** | Watertemperatuur (40–70 °C, of tot het maximum dat op de boiler zelf is ingesteld) |
| **Modus** | i-Memory, Green, Programma, Boost |
| **Aan/uit** | Boiler in- of uitschakelen |
| **Uitlezen** | Watertemperatuur, of hij aan het opwarmen is, aantal beschikbare douchebeurten |

Watertemperatuur en douchebeurten worden bijgehouden in Insights, dus je kunt het verloop over de dag terugzien.

### Flowkaarten

- **Als** — Temperatuur veranderd, Doeltemperatuur veranderd
- **En** — Modus is …, Is aan het opwarmen
- **Dan** — Stel temperatuur in, Zet modus op …, Zet aan/uit

## Goed om te weten

Uit de Atag-handleiding, en belangrijk als je flows gaat bouwen:

| Modus | Wat hij doet |
|---|---|
| **i-Memory** | Fabrieksinstelling. Leert je verbruik; **vanaf de tweede week past de boiler de ingestelde temperatuur zelf aan**. Een temperatuur die je vanuit Homey zet, kan dus later door de boiler worden overschreven. |
| **Green** | Alleen de warmtepomp, zuinigst. Temperatuur 40–53 °C; de app weigert een hogere waarde in deze modus. |
| **Programma** | Warm water op vaste tijden, warmtepomp heeft voorrang. |
| **Boost** | Warmtepomp én elektrisch element, snelst opwarmen. |

De warmtepomp komt tot 53 °C; daarboven verwarmt alleen het element. **Wil je vanuit Homey sturen** — op zonne-overschot of een dynamisch stroomtarief bijvoorbeeld — **gebruik dan Green.** Dat is de enige modus die precies doet wat je vraagt en niets achteraf bijstelt.

De status wordt standaard elke 5 minuten opgehaald, per apparaat instelbaar tussen 2 en 60 minuten. Vaker dan dat is niet verstandig: de Ariston-cloud kan je account tijdelijk blokkeren (HTTP 429).

## Problemen oplossen

**"Inloggen mislukt"** — Controleer eerst of je met dezelfde gegevens in de Atag-app komt. Klopt dat, open dan het apparaat in Homey en kies **Repareren** om opnieuw in te loggen.

**Apparaat staat op niet-beschikbaar** — De app meldt dit na drie mislukte pogingen. Meestal is de boiler offline of is de Ariston-cloud tijdelijk onbereikbaar; hij herstelt zichzelf zodra de verbinding terug is.

**Boiler verschijnt niet bij het koppelen** — De app herkent de Lydos Hybrid aan `sys=4` en `wheType=2`. Meldt jouw apparaat zich anders, dan valt hij erbuiten. Open een issue met de regel `Found n Velis plant(s): …` uit je app-logs, dan pas ik het filter aan.

## Hoe het werkt

Atag hoort bij de Ariston-groep, en de Lydos Hybrid hangt aan de **Ariston NET-cloud** — dezelfde die de Atag-app gebruikt. De endpoints zijn overgenomen uit het reverse-engineerde [python-ariston-api](https://github.com/fustom/python-ariston-api), dat ook onder de Home Assistant-integratie ligt. Basis: `https://www.ariston-net.remotethermo.com/api/v2/`

| Actie | Request |
|---|---|
| Inloggen | `POST accounts/login` `{"usr": …, "pwd": …}` → `token` (header `ar.authToken`) |
| Boilers | `GET velis/plants` |
| Status | `GET velis/sePlantData/{gw}` (`temp`, `reqTemp`, `mode`, `on`, `heatReq`, `avShw`) |
| Instellingen | `GET velis/sePlantData/{gw}/plantSettings` |
| Temperatuur | `POST velis/sePlantData/{gw}/temperature` `{"new": 55}` |
| Modus | `POST velis/sePlantData/{gw}/mode` `{"new": 2}` (1 i-Memory, 2 Green, 6 Programma, 7 Boost) |
| Aan/uit | `POST velis/sePlantData/{gw}/switch` `true` / `false` |

Je inloggegevens gaan rechtstreeks van je Homey naar Ariston en worden nergens anders opgeslagen of doorgestuurd. Zie [`lib/AristonApi.js`](lib/AristonApi.js).

## Zelf aan de slag

```bash
npm install --global homey
homey login
homey select
homey app run --remote     # tijdelijk draaien met live logs
homey app install          # permanent installeren
```

De cloudverbinding testen zonder Homey:

```bash
node scripts/test-api.js                  # inloggen, boiler zoeken, status tonen
node scripts/test-api.js --set-temp 50    # en de temperatuur zetten
```

Het script vraagt om je e-mailadres en wachtwoord. Het wachtwoord wordt niet getoond en nergens bewaard.

### Structuur

```
.homeycompose/          app-manifest en eigen capabilities (bron voor app.json)
app.json                gegenereerd door de Homey CLI; niet met de hand bewerken
lib/AristonApi.js       client voor de Ariston NET-cloud
drivers/lydos-hybrid/   driver (koppelen, flowkaarten) en device (status, besturing)
locales/                Engelse en Nederlandse teksten
scripts/                testscript en generator voor de PNG-afbeeldingen
```

Pull requests zijn welkom, vooral van mensen met een ander Lydos-model. Draai `homey app validate` voordat je iets instuurt.

## Licentie

[GPL-3.0-or-later](LICENSE)

Deze app is niet verbonden aan Atag of Ariston. De gebruikte cloud-API is niet officieel gedocumenteerd, dus Atag/Ariston kan hem zonder aankondiging veranderen.
