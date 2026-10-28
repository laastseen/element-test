'use strict';
const A=s=>document.querySelector(s), escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let session=null,records=[],answerKey=[],page=0;const pageSize=25;
const message=t=>A('#message').textContent=t;
const formatDate=v=>new Date(v).toLocaleString('ru-RU');
const duration=r=>r.submitted_at?Math.max(0,Math.round((new Date(r.submitted_at)-new Date(r.started_at))/1000))+' с':'—';
async function authRequest(path,body,method='POST'){
  if(!session)throw new Error('Войдите в кабинет.');
  if(Date.now()>session.expires_at-60000){
    try {const r=await courseApi.request('/auth/v1/token?grant_type=refresh_token',{refresh_token:session.refresh_token});session={...r,expires_at:Date.now()+r.expires_in*1000};}
    catch{logout();throw new Error('Сессия истекла. Войдите заново.');}
  }
  return courseApi.request(path,body,session.access_token,method);
}
function logout(){session=null;records=[];answerKey=[];A('#rows').replaceChildren();A('#details').replaceChildren();A('#details').hidden=true;A('#dashboard').hidden=true;A('#login').hidden=false;A('#summary').textContent='';message('Вы вышли из кабинета.');}
function filtered(){const search=A('#search').value.trim().toLocaleLowerCase('ru'),g=A('#group').value,s=A('#status').value;return records.filter(r=>r.full_name.toLocaleLowerCase('ru').includes(search)&&(!g||r.student_group===g)&&(!s||(s==='done'?!!r.submitted_at:!r.submitted_at)));}
function draw(){
 const rows=filtered(),done=rows.filter(r=>r.submitted_at),avg=done.length?(done.reduce((s,r)=>s+r.score,0)/done.length).toFixed(1):'—';
 page=Math.min(page,Math.max(0,Math.ceil(rows.length/pageSize)-1));
 A('#summary').textContent='Попыток: '+rows.length+' · Завершено: '+done.length+' · Средний балл: '+avg;
 A('#rows').innerHTML=rows.slice(page*pageSize,(page+1)*pageSize).map(r=>'<tr><td>'+escapeHtml(r.full_name)+'</td><td>'+escapeHtml(r.student_group)+'</td><td>'+escapeHtml(formatDate(r.started_at))+'</td><td>'+duration(r)+'</td><td>'+(r.score??'—')+'</td><td>'+(r.grade??'—')+'</td><td>'+(r.submitted_at?'Завершена':'Начата')+'</td><td>'+(r.submitted_at?'<button data-id="'+escapeHtml(r.id)+'">Посмотреть</button>':'—')+'</td></tr>').join('')||'<tr><td colspan="8">Попыток пока нет.</td></tr>';
 A('#page').textContent='Страница '+(page+1)+' из '+Math.max(1,Math.ceil(rows.length/pageSize));
 A('#prevPage').disabled=page===0;A('#nextPage').disabled=(page+1)*pageSize>=rows.length;
 A('#rows').querySelectorAll('button').forEach(b=>b.onclick=()=>details(b.dataset.id));
}
function details(id){
 const r=records.find(x=>x.id===id);if(!r)return;
 A('#details').hidden=false;
 A('#details').innerHTML='<h2>'+escapeHtml(r.full_name)+' · '+escapeHtml(r.student_group)+'</h2><p>Завершено: '+escapeHtml(formatDate(r.submitted_at))+' · '+r.score+'/10 · Оценка: '+r.grade+'</p><ol>'+COURSE_QUESTIONS.map((q,i)=>'<li><strong>'+escapeHtml(q[0])+'</strong><br><span class="'+(r.answers[i]===answerKey[i]?'good':'bad')+'">Ответ студента: '+escapeHtml(q[1][r.answers[i]])+'</span><br>Правильный ответ: '+escapeHtml(q[1][answerKey[i]])+'</li>').join('')+'</ol>';
 A('#details').scrollIntoView({behavior:'smooth',block:'start'});
}
async function load(){
 A('#refresh').disabled=true;message('Загружаем результаты…');
 try{
  const next=[];
  // Постраничная загрузка исключает стандартное ограничение API в 1000 строк.
  for(let offset=0;;offset+=500){
    const batch=await authRequest('/rest/v1/element_attempts?select=id,full_name,student_group,test_version,started_at,submitted_at,answers,score,grade&order=started_at.desc,id.desc&limit=500&offset='+offset,undefined,'GET');
    next.push(...batch);if(batch.length<500)break;
  }
  records=next;const old=A('#group').value;A('#group').innerHTML='<option value="">Все группы</option>'+[...new Set(records.map(r=>r.student_group))].sort().map(g=>'<option value="'+escapeHtml(g)+'">'+escapeHtml(g)+'</option>').join('');A('#group').value=old;page=0;draw();message('');
 }catch(e){message(e.message);}finally{A('#refresh').disabled=false;}
}
A('#login').onsubmit=async e=>{
 e.preventDefault();const b=e.target.querySelector('button');b.disabled=true;message('Проверяем доступ…');
 try{
  const f=new FormData(e.target),r=await courseApi.request('/auth/v1/token?grant_type=password',{email:f.get('email').trim(),password:f.get('password')});
  session={...r,expires_at:Date.now()+r.expires_in*1000};
  const allowed=await authRequest('/rest/v1/rpc/element_admin_check',{});
  if(!allowed){logout();throw new Error('У этой учётной записи нет прав преподавателя.');}
  answerKey=await authRequest('/rest/v1/rpc/element_admin_key',{});
  e.target.reset();A('#login').hidden=true;A('#dashboard').hidden=false;await load();
 }catch(err){session=null;message(err.message);}finally{b.disabled=false;}
};
A('#refresh').onclick=load;
A('#logout').onclick=async()=>{try{await authRequest('/auth/v1/logout',{});}catch{}finally{logout();}};
['#search','#group','#status'].forEach(s=>A(s).oninput=()=>{page=0;A('#details').hidden=true;draw();});
A('#prevPage').onclick=()=>{page--;draw();};A('#nextPage').onclick=()=>{page++;draw();};
A('#csv').onclick=()=>{
 // Защита от формул при открытии CSV в Excel.
 const cell=v=>{let s=String(v??'');if(/^[=+@\-\t\r\n]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
 const rows=[['ФИО','Группа','Начало','Завершение','Длительность','Балл','Оценка'],...filtered().map(r=>[r.full_name,r.student_group,formatDate(r.started_at),r.submitted_at?formatDate(r.submitted_at):'',duration(r),r.score,r.grade])];
 const blob=new Blob(['\uFEFF'+rows.map(r=>r.map(cell).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'});
 const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='element_results.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};

