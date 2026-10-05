/** 絵文字ピッカーの候補(Unicode の絵文字。LINEのテキストにそのまま入る)。サロン・予約の文面でよく使うものを中心に。 */
export interface EmojiGroup {
  id: string
  label: string
  /** タブに出す代表の絵文字 */
  icon: string
  emojis: string[]
}

// 1文字ずつ(肌色・性別・ZWJでつながった絵文字は1つ)に分け、グループ内の重複は除く
const split = (s: string): string[] => [...new Set([...new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(s.replace(/\s+/g, ''))].map((x) => x.segment))]

export const EMOJI_GROUPS: EmojiGroup[] = [
  {
    id: 'face',
    label: '顔・感情',
    icon: '😊',
    emojis: split('😀😃😄😁😆😅😂🤣😊😇🙂🙃😉😌😍🥰😘😗😙😚😋😛😜🤪😝🤗🤭🤫🤔🤐😐😑😶😏😒🙄😬😮‍💨🤥😌😔😪🤤😴😷🤒🤕🤢🤮🥵🥶🥴😵🤯🤠🥳😎🤓🧐😕😟🙁☹️😮😯😲😳🥺😦😧😨😰😥😢😭😱😖😣😞😓😩😫🥱😤😡😠🤬'),
  },
  {
    id: 'hand',
    label: '手・人',
    icon: '👍',
    emojis: split('👍👎👌🤌✌️🤞🤟🤘🤙👈👉👆👇☝️✋🤚🖐️🖖👋🤝🙏✍️💪🙌👏🤲🙋🙋‍♀️🙇🙇‍♀️💁💁‍♀️🤷🤷‍♀️🧖‍♀️💆💆‍♀️💇💇‍♀️💅🤳💃🕺👩👩‍🦰👩‍🦱👩‍🦳👱‍♀️👸👰🤰👼'),
  },
  {
    id: 'heart',
    label: 'ハート・星',
    icon: '💗',
    emojis: split('❤️🧡💛💚💙💜🖤🤍🤎💔❣️💕💞💓💗💖💘💝💟✨⭐🌟💫⚡🔥💥💢💦💧🌈☀️🌤️⛅☁️🌙🎉🎊🎁🎀🎈🏆🥇👑💎🔔📣'),
  },
  {
    id: 'nature',
    label: '自然・動物',
    icon: '🌸',
    emojis: split('🌸🌷🌹🥀🌺🌻🌼💐🌿🍀🍃🍂🍁🌱🌴🌵🌲🌳🐶🐱🐭🐹🐰🦊🐻🐼🐨🐯🦁🐮🐷🐸🐵🐔🐧🐦🐤🦋🐝🐞🐢🐬🐳🐠🌍⛄❄️🌊'),
  },
  {
    id: 'food',
    label: '食べ物',
    icon: '🍰',
    emojis: split('🍎🍊🍋🍌🍉🍇🍓🍒🍑🥭🍍🥝🍅🥑🍞🥐🧀🍳🥞🍔🍟🍕🌭🍝🍜🍣🍱🍙🍚🍰🎂🧁🍩🍪🍫🍬🍭☕🍵🥤🍺🍷🥂🍸'),
  },
  {
    id: 'place',
    label: '場所・乗り物',
    icon: '🚃',
    emojis: split('🏠🏡🏢🏬🏥🏦🏪🏫⛪🗼🗽🎡🎢🚃🚄🚅🚌🚗🚕🚲🛵✈️🚀⛵🅿️🚏📍🗺️🧭'),
  },
  {
    id: 'object',
    label: '物・サロン',
    icon: '💄',
    emojis: split('💄💅💋👁️👀👂👃👄🪞🧴🧼🧽🪒✂️💈💉💊🧪📱☎️💻📷🎥📅📆🗓️🕐🕑🕒🕓🕔🕕⏰⌛⏳📝📋📌📎🔍🔑🔒💡🛍️👗👚👠👜👓🕶️🎵🎶'),
  },
  {
    id: 'symbol',
    label: '記号',
    icon: '✅',
    emojis: split('✅☑️✔️❌❎⭕❗❓‼️⁉️💯🔴🟠🟡🟢🔵🟣⚫⚪🔶🔷🔸🔹▶️⏩◀️🔼🔽➡️⬅️⬆️⬇️↗️↩️🆗🆕🆓🆙🔥💬🗨️📩📧🔗➕➖✖️➗〰️♻️'),
  },
]
