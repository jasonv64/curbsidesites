/**
 * Curated font LOADERS (TENANT-APP Part 6). next/font resolves AT BUILD TIME
 * and is only legal in the page/layout module graph — so this file is
 * imported by src/app/layout.tsx and NOTHING ELSE. Everything else (brand.ts,
 * route handlers, the portal) reads pairing data from font-pairings.ts.
 *
 * Every pairing's faces load here and expose CSS variables on <html>; the
 * tenant's font_pairing_key selects a pairing via CSS variable indirection.
 * Adding a pairing: add the loader here + one entry in font-pairings.ts.
 */
import {
  Anton,
  Archivo,
  Archivo_Black,
  Barlow,
  Barlow_Condensed,
  Bebas_Neue,
  Chakra_Petch,
  Fraunces,
  IBM_Plex_Sans,
  Inter,
  Karla,
  League_Spartan,
  Libre_Franklin,
  Oswald,
  Rubik,
  Source_Sans_3,
  Space_Grotesk,
  Teko,
  Work_Sans,
} from "next/font/google";



const bebas = Bebas_Neue({ weight: "400", subsets: ["latin"], variable: "--f-bebas", display: "swap" });
const anton = Anton({ weight: "400", subsets: ["latin"], variable: "--f-anton", display: "swap" });
const archivoBlack = Archivo_Black({ weight: "400", subsets: ["latin"], variable: "--f-archivo-black", display: "swap" });
const archivo = Archivo({ subsets: ["latin"], variable: "--f-archivo", display: "swap" });
const oswald = Oswald({ subsets: ["latin"], variable: "--f-oswald", display: "swap" });
const inter = Inter({ subsets: ["latin"], variable: "--f-inter", display: "swap" });
const sourceSans = Source_Sans_3({ subsets: ["latin"], variable: "--f-source-sans", display: "swap" });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--f-space-grotesk", display: "swap" });
const barlowCondensed = Barlow_Condensed({ weight: ["500", "600", "700"], subsets: ["latin"], variable: "--f-barlow-condensed", display: "swap" });
const barlow = Barlow({ weight: ["400", "500", "600", "700"], subsets: ["latin"], variable: "--f-barlow", display: "swap" });
const teko = Teko({ subsets: ["latin"], variable: "--f-teko", display: "swap" });
const rubik = Rubik({ subsets: ["latin"], variable: "--f-rubik", display: "swap" });
const leagueSpartan = League_Spartan({ subsets: ["latin"], variable: "--f-league-spartan", display: "swap" });
const libreFranklin = Libre_Franklin({ subsets: ["latin"], variable: "--f-libre-franklin", display: "swap" });
const fraunces = Fraunces({ subsets: ["latin"], variable: "--f-fraunces", display: "swap" });
const karla = Karla({ subsets: ["latin"], variable: "--f-karla", display: "swap" });
const chakraPetch = Chakra_Petch({ weight: ["400", "600", "700"], subsets: ["latin"], variable: "--f-chakra", display: "swap" });
const ibmPlexSans = IBM_Plex_Sans({ weight: ["400", "500", "600", "700"], subsets: ["latin"], variable: "--f-ibm-plex", display: "swap" });
const workSans = Work_Sans({ subsets: ["latin"], variable: "--f-work-sans", display: "swap" });

/** Applied once on <html> so every pairing's variables exist for every tenant. */
export const fontVariableClasses = [
  bebas, anton, archivoBlack, archivo, oswald, inter, sourceSans, spaceGrotesk,
  barlowCondensed, barlow, teko, rubik, leagueSpartan, libreFranklin, fraunces,
  karla, chakraPetch, ibmPlexSans, workSans,
]
  .map((f) => f.variable)
  .join(" ");
