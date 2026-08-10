"""jieba-based segmentation + coarse POS bucketing for highlighting.

jieba's POS tags (ICTCLAS-style) encode broad category as the first letter
(n=noun family, v=verb family, a=adjective family, everything else is
punctuation/function words/etc). Bucketing on that first letter is exactly
the "faintly highlight nouns/verbs/adjectives" requirement — this is the fast
default tagger per PLAN.md; a spaCy + pkuseg swap-in for better accuracy is
Phase 7 scope, not this one.
"""

import jieba.posseg as pseg

_HIGHLIGHT_PREFIXES = {"n", "v", "a"}


def tag_tokens(text: str) -> list[list[str]]:
    tokens = []
    for word, flag in pseg.cut(text):
        bucket = flag[:1] if flag[:1] in _HIGHLIGHT_PREFIXES else "o"
        tokens.append([word, bucket])
    return tokens
