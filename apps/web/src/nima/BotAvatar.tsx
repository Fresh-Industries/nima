import styles from "./BotAvatar.module.css";

/** Characters Bots can wear. Stored in the Bot's avatar as `character:<id>`; any other avatar is text. */
export const BOT_CHARACTERS = [
  { id: "fox", label: "Fox", vibe: "Quick and curious" },
  { id: "owl", label: "Owl", vibe: "Calm and wise" },
  { id: "robot", label: "Robot", vibe: "Precise and tireless" },
  { id: "cook", label: "Chef", vibe: "Warm and practical" },
  { id: "scientist", label: "Scientist", vibe: "Rigorous and inquisitive" },
  { id: "technologist", label: "Builder", vibe: "Hands-on and handy" },
  { id: "detective", label: "Detective", vibe: "Sharp and thorough" },
  { id: "artist", label: "Artist", vibe: "Bold and imaginative" },
  { id: "astronaut", label: "Astronaut", vibe: "Ambitious and steady" },
  { id: "ninja", label: "Ninja", vibe: "Quiet and fast" },
  { id: "dragon", label: "Dragon", vibe: "Fierce and protective" },
  { id: "unicorn", label: "Unicorn", vibe: "Playful and optimistic" },
  { id: "alien", label: "Alien", vibe: "Unconventional thinker" },
  { id: "ghost", label: "Ghost", vibe: "Light and witty" },
  { id: "octopus", label: "Octopus", vibe: "Juggles everything" },
  { id: "panda", label: "Panda", vibe: "Easygoing and kind" },
  { id: "lion", label: "Lion", vibe: "Confident leader" },
  { id: "bear", label: "Bear", vibe: "Patient and strong" },
  { id: "penguin", label: "Penguin", vibe: "Loyal and dependable" },
  { id: "frog", label: "Frog", vibe: "Adaptable and upbeat" },
  { id: "cat", label: "Cat", vibe: "Independent and discerning" },
] as const;

type BotCharacter = (typeof BOT_CHARACTERS)[number];

const PREFIX = "character:";

export function characterAvatar(id: BotCharacter["id"]) {
  return `${PREFIX}${id}`;
}

export function characterFor(avatar: string) {
  if (!avatar.startsWith(PREFIX)) return null;
  const id = avatar.slice(PREFIX.length);
  return BOT_CHARACTERS.find((character) => character.id === id) ?? null;
}

function characterSrc(character: BotCharacter) {
  return `${import.meta.env.BASE_URL.replace(/\/$/, "")}/characters/${character.id}.webp`;
}

/** A stable character for a Bot that has not chosen an avatar, so every Bot has a face. */
function defaultCharacter(seed: string) {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return BOT_CHARACTERS[hash % BOT_CHARACTERS.length]!;
}

/**
 * A Bot's face: its character, its emoji or text avatar, or (given a `seed` such as its id)
 * a default character. `fill` sizes a character to its container instead of the text line.
 */
export function BotAvatar({
  avatar,
  name,
  seed,
  fill,
}: {
  avatar: string;
  name: string;
  seed?: string | undefined;
  fill?: boolean;
}) {
  const character =
    characterFor(avatar) ?? (!avatar.trim() && seed ? defaultCharacter(seed) : null);
  if (character)
    return (
      <img
        className={fill ? styles.fill : styles.character}
        src={characterSrc(character)}
        alt=""
        draggable={false}
      />
    );
  return <>{avatar.trim() || name.trim().charAt(0).toUpperCase() || "?"}</>;
}

/** Picks a character for a Bot; a text avatar stays selectable as it is. */
export function CharacterPicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (avatar: string) => void;
  disabled?: boolean;
}) {
  const selected = characterFor(value);
  return (
    <fieldset className={styles.picker} disabled={disabled}>
      <legend>
        Character
        {selected && <span> · {selected.vibe}</span>}
      </legend>
      <div role="radiogroup" aria-label="Character">
        {BOT_CHARACTERS.map((character) => {
          const avatar = characterAvatar(character.id);
          const checked = value === avatar;
          return (
            <button
              key={character.id}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={`${character.label}, ${character.vibe}`}
              onClick={() => onChange(checked ? "" : avatar)}
            >
              <img src={characterSrc(character)} alt="" draggable={false} loading="lazy" />
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
