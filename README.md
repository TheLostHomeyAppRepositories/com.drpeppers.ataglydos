# Atag Lydos voor Homey

Onofficiële Homey-app om een **Atag Lydos Hybrid** warmtepompboiler te bedienen.

- Gewenste watertemperatuur instellen (40–70 °C, of tot het maximum dat op de boiler is ingesteld)
- Modus kiezen: i-Memory, Green (alleen warmtepomp), Programma, Boost
- Boiler aan/uit zetten
- Uitlezen: huidige watertemperatuur, of hij aan het opwarmen is, aantal beschikbare douchebeurten

De app gebruikt de **Ariston NET-cloud** (Atag hoort bij de Ariston-groep), dezelfde als de Atag-app. De boiler moet dus via wifi verbonden zijn en werken in de Atag-app. Je logt in met hetzelfde e-mailadres en wachtwoord.

> Niet verbonden aan Atag of Ariston. De cloud-API is niet officieel gedocumenteerd, dus Atag/Ariston kan hem zonder aankondiging veranderen.

## Goed om te weten over de Lydos Hybrid

Uit de Atag-handleiding:

| Modus | Wat hij doet |
|---|---|
| **i-Memory** | Fabrieksinstelling. Leert je verbruik; **vanaf de tweede week past de boiler de ingestelde temperatuur zelf aan**. Een temperatuur die je vanuit Homey zet, kan dus later door de boiler worden overschreven. |
| **Green** | Alleen de warmtepomp, zuinigst. Temperatuur **40–53 °C**. De app weigert een hogere temperatuur in deze modus. |
| **Programma** | Warm water op vaste tijden, warmtepomp heeft voorrang. |
| **Boost** | Warmtepomp én element, snelst opwarmen. |

De warmtepomp werkt tot 53 °C; daarboven verwarmt alleen het element. Wil je vanuit Homey sturen (bijvoorbeeld op zonne-overschot of dynamische stroomprijs), dan werkt **Green** het voorspelbaarst.

## Flowkaarten

- **Dan:** Stel temperatuur in (standaard Homey-kaart), Zet modus op …, Zet aan/uit
- **En:** Modus is …, Is aan het opwarmen
- **Als:** Temperatuur veranderd, Doeltemperatuur veranderd (standaard Homey-kaarten)

## Installeren op je eigen Homey

Werkt op een **Homey Pro** (2019 en 2023) en **Homey Self-Hosted Server**. Op Homey Cloud (met Homey Bridge) kun je zelf geen apps installeren, alleen via de App Store.

```powershell
npm install --global homey   # eenmalig, Node.js 24+ aanbevolen
homey login                  # met je Athom/Homey-account
homey select                 # kies je Homey
homey app install            # vanuit deze map
```

Daarna in de Homey-app: **Apparaat toevoegen → Atag Lydos → Lydos Hybrid** en log in met je Atag-gegevens.

- `homey app install` installeert de app permanent; hij blijft draaien na een herstart.
- `homey app run --remote` draait de app tijdelijk op je Homey met live logs in je terminal. Handig voor debuggen.

## Verbinding testen zonder Homey

```powershell
node scripts/test-api.js                  # inloggen, boiler zoeken, status en instellingen tonen
node scripts/test-api.js --set-temp 50    # en de gewenste temperatuur op 50 °C zetten
```

Het script vraagt om je e-mail en wachtwoord. Het wachtwoord wordt niet getoond en nergens opgeslagen.

## Hoe het werkt

Endpoints op `https://www.ariston-net.remotethermo.com/api/v2/`, overgenomen uit de reverse-engineerde [python-ariston-api](https://github.com/fustom/python-ariston-api) (gebruikt door de Home Assistant-integratie):

| Actie | Request |
|---|---|
| Inloggen | `POST accounts/login` `{"usr": …, "pwd": …}` → `token` (header `ar.authToken`) |
| Boilers | `GET velis/plants` (Lydos Hybrid: `sys = 4`, `wheType = 2`) |
| Status | `GET velis/sePlantData/{gw}` (`temp`, `reqTemp`, `mode`, `on`, `heatReq`, `avShw`) |
| Instellingen | `GET velis/sePlantData/{gw}/plantSettings` |
| Temperatuur | `POST velis/sePlantData/{gw}/temperature` `{"new": 55}` |
| Modus | `POST velis/sePlantData/{gw}/mode` `{"new": 2}` (1 i-Memory, 2 Green, 6 Programma, 7 Boost) |
| Aan/uit | `POST velis/sePlantData/{gw}/switch` `true` / `false` |

De status wordt standaard elke 5 minuten opgehaald (instelbaar per apparaat, minimaal 2). Te vaak ophalen kan je account tijdelijk laten blokkeren (HTTP 429).

## Projectstructuur

```
.homeycompose/          app-manifest en eigen capabilities (bron voor app.json)
app.json                gegenereerd door de Homey CLI; niet met de hand bewerken
lib/AristonApi.js       client voor de Ariston NET-cloud
drivers/lydos-hybrid/   driver (koppelen, flowkaarten) en device (status, besturing)
locales/                Engelse en Nederlandse teksten
scripts/                testscript en generator voor de PNG-afbeeldingen
```
