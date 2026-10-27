/**
 * Hand-curated starter word list. Seeded into the `words` table and also used as
 * a built-in fallback when the database is unavailable.
 *
 * Format: language -> category slug -> difficulty -> entries separated by "|".
 * An entry is "word" or "word~accepted~accepted…": the extra answers (synonyms,
 * spelling variants, transliterations, translations) also count as correct guesses.
 * Only add answers that really mean the same thing.
 *
 * To add a language: add its code to `Language` / `WORD_LANGUAGES` in the shared
 * package, add category labels in `CATEGORIES`, and add a block here.
 */
import type { Difficulty, Language } from '@dws/shared';

type WordTable = Record<Language, Record<string, Record<Difficulty, string>>>;

const TABLE: WordTable = {
  en: {
    animals: {
      easy: 'cat|dog|fish|bird|cow|pig|duck|frog|lion|bear|snake|horse|mouse|rabbit~bunny|sheep|chicken~hen|monkey|tiger|elephant|turtle',
      medium: 'giraffe|penguin|octopus|kangaroo|dolphin|zebra|camel|crocodile|butterfly|spider|owl|bat|shark|whale|peacock|squirrel|snail|parrot|crab|deer',
      hard: 'chameleon|platypus|jellyfish|hedgehog|seahorse~sea horse|flamingo|porcupine|armadillo|starfish~sea star|woodpecker|sloth|scorpion|walrus|koala|lobster',
    },
    food: {
      easy: 'apple|banana|pizza|cake|egg|bread|cheese|carrot|ice cream~icecream|cookie~biscuit|grapes~grape|milk|burger~hamburger|orange|cherry|candy~sweet|corn|lemon',
      medium: 'sandwich|hot dog~hotdog|donut~doughnut|pancake|popcorn|watermelon|pineapple|spaghetti~pasta|noodles|mushroom|strawberry|taco|sushi|french fries~fries~chips|cupcake|broccoli|coconut|lollipop~lolly',
      hard: 'dosa~dosai|idli~idly|biryani~briyani|croissant|burrito|avocado|pretzel|dumpling|waffle|smoothie|kebab~kabab|samosa|cotton candy~candy floss|popsicle~ice lolly|gingerbread',
    },
    objects: {
      easy: 'chair|table|book|key|ball|cup|door|bed|clock|hat|shoe|lamp|umbrella|bell|star|sun|moon|tree|house|car|boat|kite|candle|pencil',
      medium: 'scissors|ladder|glasses~spectacles|backpack~school bag|toothbrush|mirror|balloon|guitar|crown|anchor|bicycle~bike~cycle|envelope|hammer|sofa~couch|pillow|bucket|compass|rainbow|lighthouse',
      hard: 'hourglass|wheelbarrow|chandelier|parachute|skateboard|accordion|typewriter|magnifying glass~magnifier|windmill|treasure chest|sewing machine|tent|volcano',
    },
    movies: {
      easy: 'alien|robot|ghost|pirate|cowboy|wizard|princess|superhero|dragon|king|monster|ninja',
      medium: 'titanic|frozen|toy story|jurassic park|king kong|finding nemo|godzilla|spider-man~spiderman|batman|harry potter|star wars|the lion king~lion king|zombie|vampire|mermaid|mummy',
      hard: 'jaws|inception|avatar|the matrix~matrix|ghostbusters|back to the future|kung fu panda|cinderella|pinocchio|red carpet|clapperboard|baahubali~bahubali',
    },
    sports: {
      easy: 'goal|swimming|running|football~soccer|cricket|tennis|golf|boxing|skating|medal|whistle|chess',
      medium: 'basketball|badminton|volleyball|baseball|hockey|surfing|cycling|skiing|bowling|archery|karate|kabaddi|trophy|referee|helmet',
      hard: 'wrestling|javelin|marathon|gymnastics|pole vault|snowboarding|table tennis~ping pong|weightlifting~weight lifting|high jump|scuba diving~scuba|fencing|rowing|hurdles',
    },
    technology: {
      easy: 'phone~mobile~mobile phone~cell phone~smartphone|computer~pc|television~tv|camera|radio|battery|keyboard|headphones~headphone~earphones|light bulb~lightbulb~bulb|rocket|laptop|remote~remote control|plug',
      medium: 'satellite|printer|microphone~mic|drone|smartwatch~smart watch|calculator|joystick|charger|speaker|wifi~wi-fi|email~e-mail|video game~videogame|tablet|antenna|solar panel|telescope',
      hard: 'virtual reality~vr|3d printer|circuit board|bluetooth|password|qr code|barcode|router|selfie stick|electric car|space station|microscope|hologram',
    },
  },
  ta: {
    animals: {
      easy: 'யானை~yaanai~yanai~elephant|பூனை~poonai~punai~cat|நாய்~naai~nai~dog|மீன்~meen~fish|மாடு~maadu~madu~cow|ஆடு~aadu~adu~goat|எலி~eli~rat|கோழி~kozhi~koli~hen|சிங்கம்~singam~lion|புலி~puli~tiger|குரங்கு~kurangu~monkey|பாம்பு~paambu~pambu~snake',
      medium: 'குதிரை~kuthirai~kudhirai~horse|மயில்~mayil~peacock|கிளி~kili~parrot|ஆமை~aamai~amai~tortoise|முயல்~muyal~rabbit|கரடி~karadi~bear|தவளை~thavalai~frog|காகம்~kaagam~kakam~crow|வாத்து~vaathu~vathu~duck|நண்டு~nandu~crab|மான்~maan~deer|ஆந்தை~aanthai~anthai~owl|எறும்பு~erumbu~ant',
      hard: 'ஒட்டகம்~ottagam~camel|ஒட்டகச்சிவிங்கி~ottagachivingi~giraffe|வண்ணத்துப்பூச்சி~vannathupoochi~butterfly|சிலந்தி~silanthi~spider|முதலை~muthalai~mudhalai~crocodile|வௌவால்~vavval~bat|திமிங்கலம்~thimingalam~whale|கங்காரு~kangaroo|பென்குயின்~penguin|நத்தை~nathai~snail',
    },
    food: {
      easy: 'இட்லி~idli~idly|தோசை~dosai~dosa|வடை~vadai~vada|பால்~paal~milk|முட்டை~muttai~egg|சாதம்~saadham~satham~rice|கேக்~cake|லட்டு~laddu~ladoo',
      medium: 'பொங்கல்~pongal|வாழைப்பழம்~vaazhaipazham~vazhaipazham~banana|மாம்பழம்~maambazham~mambazham~mango|தேங்காய்~thengai~coconut|பிரியாணி~biryani~briyani|சப்பாத்தி~chapathi~chapati|பரோட்டா~parotta~porotta|ஐஸ்கிரீம்~ice cream~icecream|திராட்சை~thiratchai~grapes|தக்காளி~thakkali~tomato|மிளகாய்~milagai~chilli~chili|கரும்பு~karumbu~sugarcane',
      hard: 'பலாப்பழம்~palappazham~jackfruit|தர்பூசணி~tharboosani~watermelon|வெங்காயம்~vengayam~onion|பாயசம்~payasam~paayasam|முறுக்கு~murukku|அப்பளம்~appalam~papad|பஜ்ஜி~bajji|கொழுக்கட்டை~kozhukattai|சமோசா~samosa',
    },
    objects: {
      easy: 'குடை~kudai~umbrella|பந்து~panthu~pandhu~ball|பூ~poo~flower|மரம்~maram~tree|வீடு~veedu~house|கதவு~kathavu~kadhavu~door|பை~pai~bag|பேனா~pena~pen|சாவி~saavi~savi~key|மணி~mani~bell|நிலா~nila~moon|தொப்பி~thoppi~cap',
      medium: 'கடிகாரம்~kadigaram~clock|நாற்காலி~naarkaali~narkali~chair|மேசை~mesai~table|புத்தகம்~puthagam~book|கண்ணாடி~kannadi~mirror|பூட்டு~poottu~lock|விளக்கு~vilakku~lamp|பட்டம்~pattam~kite|சீப்பு~seeppu~comb|செருப்பு~seruppu~slipper|ஜன்னல்~jannal~window|படகு~padagu~boat|ஏணி~eni~ladder|மழை~mazhai~rain|வானவில்~vaanavil~rainbow|சூரியன்~sooriyan~suriyan~sun|பேருந்து~perunthu~bus|ரயில்~rayil~train|கப்பல்~kappal~ship|விமானம்~vimanam~aeroplane~airplane',
      hard: 'கத்தரிக்கோல்~kathirikol~scissors|மெழுகுவர்த்தி~mezhuguvarthi~candle|பம்பரம்~pambaram~spinning top|கோலம்~kolam~rangoli|நட்சத்திரம்~natchathiram~star|மிதிவண்டி~mithivandi~bicycle|குத்துவிளக்கு~kuthuvilakku',
    },
    movies: {
      easy: 'பேய்~pei~ghost|ராஜா~raja~king|ராணி~rani~queen|திரை~thirai~screen',
      medium: 'வில்லன்~villain|கதாநாயகன்~kathanayagan~hero|துப்பாக்கி~thuppakki|கில்லி~ghilli~gilli|லியோ~leo|பில்லா~billa|கைதி~kaithi|விக்ரம்~vikram',
      hard: 'மாஸ்டர்~master|ஜெயிலர்~jailer|எந்திரன்~enthiran~endhiran|பாகுபலி~baahubali~bahubali|பாட்ஷா~baasha~basha|அந்நியன்~anniyan|சிவாஜி~sivaji|பொன்னியின் செல்வன்~ponniyin selvan|சூரரைப் போற்று~soorarai pottru~soorarai potru',
    },
    sports: {
      easy: 'ஓட்டம்~ottam~running|நீச்சல்~neechal~swimming|கிரிக்கெட்~cricket|கபடி~kabaddi|பதக்கம்~pathakkam~medal|கோப்பை~koppai~trophy',
      medium: 'கால்பந்து~kaalpanthu~football|கூடைப்பந்து~koodaipanthu~basketball|கைப்பந்து~kaipanthu~volleyball|பூப்பந்து~pooppanthu~badminton|டென்னிஸ்~tennis|சதுரங்கம்~sathurangam~chess|மட்டை~mattai~bat|ஹாக்கி~hockey',
      hard: 'சிலம்பம்~silambam|குத்துச்சண்டை~kuthuchandai~boxing|மல்யுத்தம்~malyutham~wrestling|உயரம் தாண்டுதல்~high jump|நீளம் தாண்டுதல்~long jump|கோல்ஃப்~golf|ஜல்லிக்கட்டு~jallikattu|வில்வித்தை~vilvithai~archery',
    },
    technology: {
      easy: 'ரோபோ~robo~robot|கணினி~kanini~computer|கைபேசி~கைப்பேசி~kaipesi~mobile~phone|வானொலி~vaanoli~radio|கேமரா~camera|ராக்கெட்~rocket',
      medium: 'தொலைக்காட்சி~tholaikatchi~television~tv|மின்விசிறி~minvisiri~fan|மின்கலம்~minkalam~battery|விசைப்பலகை~visaippalagai~keyboard|மின்விளக்கு~minvilakku~bulb~light bulb|ஹெட்போன்~headphone~headphones|கால்குலேட்டர்~calculator',
      hard: 'செயற்கைக்கோள்~seyarkaikol~satellite|அச்சுப்பொறி~achuppori~printer|ஒலிவாங்கி~olivangi~microphone|தொலைநோக்கி~tholainokki~telescope|நுண்ணோக்கி~nunnokki~microscope|மின்னஞ்சல்~minnanjal~email|இணையம்~inaiyam~internet',
    },
  },
};

export interface SeedWord {
  language: Language;
  category: string;
  difficulty: Difficulty;
  text: string;
  /** Extra accepted answers. */
  accepted: string[];
}

export function seedWords(): SeedWord[] {
  const out: SeedWord[] = [];
  const seen = new Set<string>();
  for (const [language, categories] of Object.entries(TABLE) as [Language, WordTable[Language]][]) {
    for (const [category, levels] of Object.entries(categories)) {
      for (const [difficulty, list] of Object.entries(levels) as [Difficulty, string][]) {
        for (const raw of list.split('|')) {
          const [main = '', ...alternatives] = raw.split('~').map((s) => s.trim().normalize('NFC'));
          const key = `${language}:${category}:${main}`;
          if (!main || seen.has(key)) continue;
          seen.add(key);
          const accepted = [...new Set(alternatives.filter((a) => a && a !== main))];
          out.push({ language, category, difficulty, text: main, accepted });
        }
      }
    }
  }
  return out;
}
