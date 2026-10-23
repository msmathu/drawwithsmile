/**
 * Hand-curated starter word list. Seeded into the `words` table and also used as
 * a built-in fallback when the database is unavailable.
 *
 * Format: language -> category slug -> difficulty -> words separated by "|".
 * Add words freely; duplicates within a category are ignored by the seeder.
 */
import type { Difficulty, Language } from '@dws/shared';

type WordTable = Record<Language, Record<string, Record<Difficulty, string>>>;

const TABLE: WordTable = {
  en: {
    animals: {
      easy: 'cat|dog|fish|bird|cow|pig|duck|frog|lion|bear|snake|horse|mouse|rabbit|sheep|chicken|monkey|tiger|elephant|turtle',
      medium: 'giraffe|penguin|octopus|kangaroo|dolphin|zebra|camel|crocodile|butterfly|spider|owl|bat|shark|whale|peacock|squirrel|snail|parrot|crab|deer',
      hard: 'chameleon|platypus|jellyfish|hedgehog|seahorse|flamingo|porcupine|armadillo|starfish|woodpecker|sloth|scorpion|walrus|koala|lobster',
    },
    food: {
      easy: 'apple|banana|pizza|cake|egg|bread|cheese|carrot|ice cream|cookie|grapes|milk|burger|orange|cherry|candy|corn|lemon',
      medium: 'sandwich|hot dog|donut|pancake|popcorn|watermelon|pineapple|spaghetti|noodles|mushroom|strawberry|taco|sushi|french fries|cupcake|broccoli|coconut|lollipop',
      hard: 'dosa|idli|biryani|croissant|burrito|avocado|pretzel|dumpling|waffle|smoothie|kebab|samosa|cotton candy|popsicle|gingerbread',
    },
    objects: {
      easy: 'chair|table|book|key|ball|cup|door|bed|clock|hat|shoe|lamp|umbrella|bell|star|sun|moon|tree|house|car|boat|kite|candle|pencil',
      medium: 'scissors|ladder|glasses|backpack|toothbrush|mirror|balloon|guitar|crown|anchor|bicycle|envelope|hammer|sofa|pillow|bucket|compass|rainbow|lighthouse',
      hard: 'hourglass|wheelbarrow|chandelier|parachute|skateboard|accordion|typewriter|magnifying glass|windmill|treasure chest|sewing machine|tent|volcano',
    },
    movies: {
      easy: 'alien|robot|ghost|pirate|cowboy|wizard|princess|superhero|dragon|king|monster|ninja',
      medium: 'titanic|frozen|toy story|jurassic park|king kong|finding nemo|godzilla|spider-man|batman|harry potter|star wars|the lion king|zombie|vampire|mermaid|mummy',
      hard: 'jaws|inception|avatar|the matrix|ghostbusters|back to the future|kung fu panda|cinderella|pinocchio|red carpet|clapperboard|baahubali',
    },
    sports: {
      easy: 'goal|swimming|running|football|cricket|tennis|golf|boxing|skating|medal|whistle|chess',
      medium: 'basketball|badminton|volleyball|baseball|hockey|surfing|cycling|skiing|bowling|archery|karate|kabaddi|trophy|referee|helmet',
      hard: 'wrestling|javelin|marathon|gymnastics|pole vault|snowboarding|table tennis|weightlifting|high jump|scuba diving|fencing|rowing|hurdles',
    },
    technology: {
      easy: 'phone|computer|television|camera|radio|battery|keyboard|headphones|light bulb|rocket|laptop|remote|plug',
      medium: 'satellite|printer|microphone|drone|smartwatch|calculator|joystick|charger|speaker|wifi|email|video game|tablet|antenna|solar panel|telescope',
      hard: 'virtual reality|3d printer|circuit board|bluetooth|password|qr code|barcode|router|selfie stick|electric car|space station|microscope|hologram',
    },
  },
  ta: {
    animals: {
      easy: 'யானை|பூனை|நாய்|மீன்|மாடு|ஆடு|எலி|கோழி|சிங்கம்|புலி|குரங்கு|பாம்பு',
      medium: 'குதிரை|மயில்|கிளி|ஆமை|முயல்|கரடி|தவளை|காகம்|வாத்து|நண்டு|மான்|ஆந்தை|எறும்பு',
      hard: 'ஒட்டகம்|ஒட்டகச்சிவிங்கி|வண்ணத்துப்பூச்சி|சிலந்தி|முதலை|வௌவால்|திமிங்கலம்|கங்காரு|பென்குயின்|நத்தை',
    },
    food: {
      easy: 'இட்லி|தோசை|வடை|பால்|முட்டை|சாதம்|கேக்|லட்டு',
      medium: 'பொங்கல்|வாழைப்பழம்|மாம்பழம்|தேங்காய்|பிரியாணி|சப்பாத்தி|பரோட்டா|ஐஸ்கிரீம்|திராட்சை|தக்காளி|மிளகாய்|கரும்பு',
      hard: 'பலாப்பழம்|தர்பூசணி|வெங்காயம்|பாயசம்|முறுக்கு|அப்பளம்|பஜ்ஜி|கொழுக்கட்டை|சமோசா',
    },
    objects: {
      easy: 'குடை|பந்து|பூ|மரம்|வீடு|கதவு|பை|பேனா|சாவி|மணி|நிலா|தொப்பி',
      medium: 'கடிகாரம்|நாற்காலி|மேசை|புத்தகம்|கண்ணாடி|பூட்டு|விளக்கு|பட்டம்|சீப்பு|செருப்பு|ஜன்னல்|படகு|ஏணி|மழை|வானவில்|சூரியன்|பேருந்து|ரயில்|கப்பல்|விமானம்',
      hard: 'கத்தரிக்கோல்|மெழுகுவர்த்தி|பம்பரம்|கோலம்|நட்சத்திரம்|மிதிவண்டி|குத்துவிளக்கு',
    },
    movies: {
      easy: 'பேய்|ராஜா|ராணி|திரை',
      medium: 'வில்லன்|கதாநாயகன்|துப்பாக்கி|கில்லி|லியோ|பில்லா|கைதி|விக்ரம்',
      hard: 'மாஸ்டர்|ஜெயிலர்|எந்திரன்|பாகுபலி|பாட்ஷா|அந்நியன்|சிவாஜி|பொன்னியின் செல்வன்|சூரரைப் போற்று',
    },
    sports: {
      easy: 'ஓட்டம்|நீச்சல்|கிரிக்கெட்|கபடி|பதக்கம்|கோப்பை',
      medium: 'கால்பந்து|கூடைப்பந்து|கைப்பந்து|பூப்பந்து|டென்னிஸ்|சதுரங்கம்|மட்டை|ஹாக்கி',
      hard: 'சிலம்பம்|குத்துச்சண்டை|மல்யுத்தம்|உயரம் தாண்டுதல்|நீளம் தாண்டுதல்|கோல்ஃப்|ஜல்லிக்கட்டு|வில்வித்தை',
    },
    technology: {
      easy: 'ரோபோ|கணினி|கைபேசி|வானொலி|கேமரா|ராக்கெட்',
      medium: 'தொலைக்காட்சி|மின்விசிறி|மின்கலம்|விசைப்பலகை|மின்விளக்கு|ஹெட்போன்|கால்குலேட்டர்',
      hard: 'செயற்கைக்கோள்|அச்சுப்பொறி|ஒலிவாங்கி|தொலைநோக்கி|நுண்ணோக்கி|மின்னஞ்சல்|இணையம்',
    },
  },
};

export interface SeedWord {
  language: Language;
  category: string;
  difficulty: Difficulty;
  text: string;
}

export function seedWords(): SeedWord[] {
  const out: SeedWord[] = [];
  const seen = new Set<string>();
  for (const [language, categories] of Object.entries(TABLE) as [Language, WordTable[Language]][]) {
    for (const [category, levels] of Object.entries(categories)) {
      for (const [difficulty, list] of Object.entries(levels) as [Difficulty, string][]) {
        for (const raw of list.split('|')) {
          const text = raw.trim().normalize('NFC');
          const key = `${language}:${category}:${text}`;
          if (!text || seen.has(key)) continue;
          seen.add(key);
          out.push({ language, category, difficulty, text });
        }
      }
    }
  }
  return out;
}
