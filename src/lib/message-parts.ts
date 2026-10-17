// Splitting assistant text into paragraphs, sentences, and inline
// segments (plain text vs. clickable search terms). Every splitter
// guarantees its parts join back to the exact original string.

export interface TextSegment {
  text: string;
  isTerm: boolean;
  term?: string;
}

export function splitParagraphs(text: string): string[] {
  return text.split(/\n+/);
}

// Words that are common enough that making them tappable would just
// be noise. Kept lowercase for comparisons.
const STOPWORDS = new Set(
  [
    "about", "above", "actually", "after", "again", "against", "ain't", "aint",
    "already", "also", "answer", "answers", "anything", "aren't", "arent",
    "before", "begin", "begins", "being", "below", "between", "block", "blocks",
    "can't", "cannot", "could", "couldn't", "couldnt", "don't", "dont", "down",
    "either", "enough", "every", "everything", "first", "getting", "goals",
    "give", "gives", "giving", "going", "good", "great",
    "hadn't", "hadnt", "hasn't", "hasnt",
    "haven't", "havent", "he's", "here", "hours", "i'll", "i'm", "i've",
    "into", "isn't", "isnt", "it's", "itself", "keep",
    "keeps", "keeping", "kind", "large", "last", "later", "let's", "little",
    "long", "look", "looking", "looks",
    "make", "makes", "making", "many", "maybe", "might", "mightn't",
    "minute", "minutes", "months", "more", "most", "much",
    "mustn't", "mustnt", "needn't", "neednt",
    "never", "next", "nice", "nothing", "often", "once", "only", "other",
    "ought", "ours", "ourselves", "over", "probably", "question",
    "questions", "really", "right",
    "save", "saved", "saves", "saving", "shan't", "she'd", "she'll", "she's",
    "short", "should", "shouldn't", "shouldnt", "since", "small", "some",
    "something", "sort", "start", "started", "starting", "starts", "stay",
    "stays", "such", "sure", "take", "takes", "taking", "than", "that",
    "that's", "thats", "their", "theirs", "them", "themselves", "then",
    "there", "there's", "theres", "these", "they", "they'd", "they'll",
    "they're", "they've", "thing", "things", "think", "this", "those",
    "through", "today", "tomorrow", "tonight", "trying", "under", "until",
    "usually", "very", "want", "wants", "wasn't", "wasnt", "we'd", "we'll",
    "we're", "we've", "weeks", "well", "weren't", "werent", "what",
    "what's", "when", "when's", "where", "where's", "which", "while", "whom",
    "will", "with", "won't", "wont", "worth", "would", "wouldn't", "wouldnt",
    "write", "writes", "writing", "years", "yesterday", "you'd", "you'll",
    "you're", "you've", "your", "yours", "yourself", "yourselves",
  ]
);

// Deciding whether a token is worth underlining. Strips surrounding
// punctuation so "deadline." → "deadline".
function cleanToken(t: string): string {
  return t.replace(/^[^\p{L}\p{N}$]+|[^\p{L}\p{N}%$]+$/gu, "");
}

function isMeaningfulWord(word: string): boolean {
  if (word.length < 5) return false;
  return !STOPWORDS.has(word.toLowerCase());
}

// Splits one sentence into text segments, marking up to maxTerms
// clickable search-term spans. Segments join back to the sentence.
// Proper nouns and acronyms win over generic content words.
export function tokenizeSentenceTerms(
  sentence: string,
  maxTerms = 2
): TextSegment[] {
  const parts = sentence.split(/(\s+)/);
  let seenText = false;

  interface Cand {
    index: number;
    cleaned: string;
    proper: boolean;
  }
  const candidates: Cand[] = [];

  parts.forEach((part, index) => {
    if (/^\s*$/.test(part)) return;
    const cleaned = cleanToken(part);
    const isFirstToken = !seenText;
    seenText = true;
    const isAcronym =
      cleaned.length >= 2 &&
      /^[\p{Lu}]+$/u.test(cleaned) &&
      cleaned === cleaned.toUpperCase();
    const isCapitalizedPhrase =
      cleaned.length >= 3 &&
      /^[\p{L}][\p{L}\p{N}'.&]*$/u.test(cleaned) &&
      cleaned[0] === cleaned[0].toUpperCase() &&
      (!isFirstToken || isMeaningfulWord(cleaned));
    const isWord =
      cleaned.length >= 5 &&
      /^[\p{Ll}]+$/u.test(cleaned) &&
      isMeaningfulWord(cleaned);
    if (isAcronym || isCapitalizedPhrase) {
      candidates.push({ index, cleaned, proper: true });
    } else if (isWord) {
      candidates.push({ index, cleaned, proper: false });
    }
  });

  const chosen = new Set<number>();
  for (const c of candidates.filter((c) => c.proper).slice(0, maxTerms)) {
    chosen.add(c.index);
  }
  for (const c of candidates.filter((c) => !c.proper)) {
    if (chosen.size >= maxTerms) break;
    chosen.add(c.index);
  }

  const segments: TextSegment[] = [];
  parts.forEach((part, index) => {
    if (!chosen.has(index)) {
      segments.push({ text: part, isTerm: false });
      return;
    }
    const cleaned = cleanToken(part);
    const leading = part.slice(0, part.indexOf(cleaned));
    const trailing = part.slice(part.indexOf(cleaned) + cleaned.length);
    if (leading) segments.push({ text: leading, isTerm: false });
    segments.push({ text: cleaned, isTerm: true, term: cleaned });
    if (trailing) segments.push({ text: trailing, isTerm: false });
  });
  return segments;
}

export function splitSentences(paragraph: string): string[] {
  const out = paragraph.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g);
  return out ?? [paragraph];
}
