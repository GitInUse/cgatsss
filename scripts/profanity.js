// Message-board moderation runs on the server, including for older stored messages.
const stretch = word => [...word].map(letter => `${letter}+`).join('');
const strong = new RegExp(['fuck','fck','fuk','shit','bitch','bastard','asshole','arsehole','cunt','motherfucker','bullshit'].map(stretch).join('|'));
const bounded = new RegExp(`^(?:${['ass','arse','dick','cock','pussy','prick','twat','wank','piss','damn','crap','slut','whore'].map(stretch).join('|')})(?:s+|e+s+|e+d+|i+n+g+|e+r+s*|h+e+a+d+s*|b+a+g+s*|f+a+c+e+s*)?$`);
const harmless = new Set(['class','classes','classic','classroom','assignment','pass','passed','passing','passenger','assist','assistance','bass','grass','cocktail','cocktails','cockatoo','peacock','peacocks','shiitake','scunthorpe','dickens']);
export function censorMessage(value) {
 return String(value).replace(/[\p{L}\p{N}@$!|]+(?:[._*\-\u200B-\u200D]+[\p{L}\p{N}@$!|]+)*/gu, token => {
  const plain=token.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[._*\-\u200B-\u200D]/g,'').replace(/[013457@$!|]/g, c=>({'0':'o','1':'i','3':'e','4':'a','5':'s','7':'t','@':'a','$':'s','!':'i','|':'i'}[c]));
  return !harmless.has(plain)&&(strong.test(plain)||bounded.test(plain))?'**'+(token.match(/[!|@$]+$/)?.[0]||''):token;
 });
}
export const censorBoardMessage = row => ({...row,author:censorMessage(row.author),message:censorMessage(row.message)});
