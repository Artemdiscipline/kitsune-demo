import {telegramConfig,telegramCall} from './telegram.mjs';
import {openStore} from './store.mjs';

const config=telegramConfig();
if(config.mode!=='telegram')throw new Error('Для бота задайте APP_MODE=telegram и переменные из .env.example.');
const store=openStore(process.env.DATABASE_PATH || './data/kitsune.sqlite');
let running=true;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{running=false;});
await telegramCall(config.token,'setMyCommands',{commands:[{command:'start',description:'Открыть витрину украшений'}]});
await telegramCall(config.token,'setChatMenuButton',{menu_button:{type:'web_app',text:'Витрина KITSUNE',web_app:{url:config.miniAppUrl}}});
console.log('Бот запущен. Уведомления о запросах отправляет сервер только в TEST_ADMIN_CHAT_ID.');
try {
  while(running){
    try {
      const updates=await telegramCall(config.token,'getUpdates',{offset:store.getOffset(),timeout:30,allowed_updates:['message']});
      for(const update of updates){
        const message=update.message;
        if(message?.chat?.type==='private' && message.chat.id===message.from?.id && /^\/start(?:@\w+)?(?:\s|$)/.test(message.text || '')) {
          await telegramCall(config.token,'sendMessage',{chat_id:message.chat.id,text:'KITSUNE · Украшения для пирсинга\nВыберите понравившиеся украшения. Администратор уточнит наличие и поможет с окончательным выбором. Это запрос на резерв: наличие сначала подтверждает сотрудник.',reply_markup:{inline_keyboard:[[{text:'Открыть витрину',web_app:{url:config.miniAppUrl}}]]}});
        }
        store.setOffset(update.update_id+1);
      }
    }catch{console.warn('Связь с Telegram временно недоступна. Повтор через 5 секунд.');await new Promise(resolve=>setTimeout(resolve,5000));}
  }
}finally{store.close();}
