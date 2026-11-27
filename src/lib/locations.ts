// Places an order can be delivered to. The country and city lists are short
// on purpose; an area that is missing can always be typed in by choosing
// "Other…" on the order screen.

export const COUNTRIES = [
  "United Arab Emirates",
  "Saudi Arabia",
  "Oman",
  "Qatar",
  "Kuwait",
  "Bahrain",
] as const;

export const DEFAULT_COUNTRY = COUNTRIES[0];

// Cities of the UAE with their best-known areas.
export const UAE_AREAS: Record<string, string[]> = {
  Dubai: [
    "Al Barsha",
    "Al Furjan",
    "Al Garhoud",
    "Al Karama",
    "Al Khawaneej",
    "Al Mamzar",
    "Al Nahda",
    "Al Quoz",
    "Al Qusais",
    "Al Rashidiya",
    "Al Satwa",
    "Al Warqa",
    "Arabian Ranches",
    "Bur Dubai",
    "Business Bay",
    "Damac Hills",
    "Deira",
    "Discovery Gardens",
    "Downtown Dubai",
    "Dubai Hills",
    "Dubai Investment Park",
    "Dubai Marina",
    "Dubai Silicon Oasis",
    "Dubai South",
    "Dubai Sports City",
    "Dubailand",
    "International City",
    "Jebel Ali",
    "Jumeirah",
    "Jumeirah Lake Towers (JLT)",
    "Jumeirah Village Circle (JVC)",
    "Mirdif",
    "Motor City",
    "Muhaisnah",
    "Nad Al Sheba",
    "Palm Jumeirah",
    "The Greens",
    "Town Square",
    "Umm Suqeim",
  ],
  "Abu Dhabi": [
    "Al Bateen",
    "Al Khalidiyah",
    "Al Mushrif",
    "Al Nahyan",
    "Al Raha",
    "Al Reef",
    "Al Reem Island",
    "Al Shamkha",
    "Al Wahda",
    "Al Zahiyah",
    "Baniyas",
    "Corniche",
    "Khalifa City",
    "Madinat Zayed",
    "Mohammed Bin Zayed City",
    "Mussafah",
    "Saadiyat Island",
    "Shakhbout City",
    "Yas Island",
  ],
  Sharjah: [
    "Al Khan",
    "Al Majaz",
    "Al Nabba",
    "Al Nahda",
    "Al Qasimia",
    "Al Rahmaniya",
    "Al Taawun",
    "Aljada",
    "Industrial Area",
    "Khor Fakkan",
    "Kalba",
    "Muwaileh",
    "Rolla",
    "Tilal City",
    "University City",
  ],
  Ajman: [
    "Ajman Corniche",
    "Al Hamidiya",
    "Al Jurf",
    "Al Mowaihat",
    "Al Nuaimiya",
    "Al Rashidiya",
    "Al Rawda",
    "Emirates City",
  ],
  "Al Ain": [
    "Al Hili",
    "Al Jimi",
    "Al Maqam",
    "Al Muwaiji",
    "Al Towayya",
    "Falaj Hazza",
    "Zakher",
  ],
  "Ras Al Khaimah": [
    "Al Dhait",
    "Al Hamra",
    "Al Nakheel",
    "Julphar",
    "Khuzam",
    "Mina Al Arab",
  ],
  Fujairah: ["Al Faseel", "Dibba", "Fujairah City", "Mirbah", "Sakamkam"],
  "Umm Al Quwain": ["Al Ramlah", "Al Salamah", "Falaj Al Mualla", "UAQ Marina"],
};

export const UAE_CITIES = Object.keys(UAE_AREAS);

// The short code a city goes by, as couriers write it: Dubai is DXB.
const CITY_CODES: Record<string, string> = {
  Dubai: "DXB",
  "Abu Dhabi": "AUH",
  Sharjah: "SHJ",
  Ajman: "AJM",
  "Al Ain": "AAN",
  "Ras Al Khaimah": "RAK",
  Fujairah: "FUJ",
  "Umm Al Quwain": "UAQ",
};

// Any other city gets its first three letters.
export function cityCode(city: string | null | undefined) {
  const name = city?.trim();
  if (!name) return "";
  return CITY_CODES[name] ?? name.replace(/[^a-z]/gi, "").slice(0, 3).toUpperCase();
}
