import {test} from 'node:test';
import assert from 'node:assert/strict';
import {censorMessage,censorBoardMessage} from '../scripts/profanity.js';
test('message board masks swearing, stretched letters, case, compounds and common evasions',()=>{
 for(const word of ['fuck','fuckk','fucccckkkk','FUUUCCKKK','fucking','motherfucker','shit','shiiittt','bullshit','biiitch','asshole','ass','dickhead','cock','pussy','prick','twat','wanker','piss','damn','crap','f.u.c.k','f_u_c_k','f*ck','sh1t','b!tch','ＦＵＣＫ']){
  assert.equal(censorMessage(`Hey ${word}, wow!`),'Hey **, wow!',word);
 }
 for(const word of ['class','classroom','assignment','passenger','assistant','grass','cocktail','peacock','Scunthorpe','Dickens','shiitake','costumes','spooky'])assert.equal(censorMessage(word),word);
 assert.equal(censorMessage('fuckk shit!!!'),'** **!!!');
 assert.deepEqual(censorBoardMessage({id:'old',author:'fucccckkkk',message:'shiiit',hidden:0}),{id:'old',author:'**',message:'**',hidden:0});
});
