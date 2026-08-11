"""Anki .apkg export via genanki — straight from the vocab table to a deck.

Model/deck IDs are fixed (not random) so re-exporting after adding more
words updates the same Anki note type/deck on import instead of creating
duplicates.
"""

import genanki

MODEL_ID = 1607392319
DECK_ID = 1607392320

MODEL = genanki.Model(
    MODEL_ID,
    "Midget Mandarin Vocab",
    fields=[
        {"name": "Hanzi"},
        {"name": "Traditional"},
        {"name": "Pinyin"},
        {"name": "Definition"},
    ],
    templates=[
        {
            "name": "Card 1",
            "qfmt": '<div style="font-size: 48px; text-align: center;">{{Hanzi}}</div>',
            "afmt": (
                '{{FrontSide}}<hr id="answer">'
                '<div style="font-size: 28px; text-align: center;">{{Pinyin}}</div>'
                '{{#Traditional}}<div style="text-align: center; color: #888;">{{Traditional}}</div>{{/Traditional}}'
                '<div style="margin-top: 12px;">{{Definition}}</div>'
            ),
        }
    ],
)


def export_apkg(words: list[dict], deck_name: str, output_path: str) -> None:
    deck = genanki.Deck(DECK_ID, deck_name)
    for w in words:
        simplified = w["simplified"]
        traditional = w.get("traditional") or ""
        note = genanki.Note(
            model=MODEL,
            fields=[
                simplified,
                traditional if traditional != simplified else "",
                w.get("pinyin") or "",
                w.get("definition") or "",
            ],
        )
        deck.add_note(note)
    genanki.Package(deck).write_to_file(output_path)
