'use strict';
let quizAttempt = null, quizStartRequest = null, quizAnswers = Array(10).fill(null), quizResult = null, quizBusy = false;
function renderQuiz() {
  const host = document.querySelector('#lesson');
  const h = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const status = text => {const e=host.querySelector('[role=status]'); if(e)e.textContent=text;};
  if(quizResult) {
    host.innerHTML = '<span class="step-tag">ИТОГОВЫЙ ТЕСТ</span><h1>Тест завершён</h1><div class="score"><b>'+quizResult.score+' / 10</b><p>'+h(quizAttempt.full_name)+' · '+h(quizAttempt.student_group)+'</p><p>Оценка: '+quizResult.grade+' · '+quizResult.score*10+'%</p></div><p class="note">Результат сохранён и доступен преподавателю.</p><button id="backCourse">К учебному материалу</button>';
    host.querySelector('#backCourse').onclick=()=>render(0,true); return;
  }
  if(!quizAttempt) {
    host.innerHTML = '<span class="step-tag">ИТОГОВЫЙ ТЕСТ</span><h1>Проверьте знания</h1><p>10 вопросов, в каждом один правильный ответ. За верный ответ — 1 балл.</p><p class="small muted">Оценка: 9–10 баллов — «5», 7–8 — «4», 5–6 — «3», 0–4 — «2».</p><form id="quizStart" class="card"><div class="fields"><label>Фамилия, имя и отчество<input name="fio" autocomplete="name" required minlength="5" maxlength="160" placeholder="Иванов Иван Иванович"></label><label>Группа<input name="group" required maxlength="40" placeholder="ИСП-124"></label></div><p class="small muted">ФИО, группа, время прохождения и ответы будут сохранены для проверки преподавателем.</p><button>Начать тест</button><p role="status" aria-live="polite"></p></form>';
    host.querySelector('form').onsubmit=async e=>{
      e.preventDefault(); if(quizBusy)return;
      const f=new FormData(e.target), name=f.get('fio').trim().replace(/\s+/g,' '), group=f.get('group').trim();
      if(name.length<5||name.split(' ').length<2){status('Введите как минимум фамилию и имя.');return;}
      if(!group){status('Введите группу.');return;}
      quizBusy=true; const b=e.target.querySelector('button');b.disabled=true;status('Создаём попытку…');
      if(!quizStartRequest || quizStartRequest.name!==name || quizStartRequest.group!==group) quizStartRequest={token:crypto.randomUUID(),name,group};
      const token=quizStartRequest.token;
      try {
        // Токен создаётся до запроса: повтор после сетевого сбоя не создаст дубль.
        quizAttempt={token,full_name:name,student_group:group,pending:true};
        await courseApi.rpc('element_start',{p_token:token,p_name:name,p_group:group});
        quizAttempt.pending=false; renderQuiz();
      } catch(err) {quizAttempt=null; status(err.message);}
      finally {quizBusy=false;b.disabled=false;}
    }; return;
  }
  host.innerHTML='<span class="step-tag">ИТОГОВЫЙ ТЕСТ</span><h1>Тестирование</h1><p>'+h(quizAttempt.full_name)+' · '+h(quizAttempt.student_group)+'</p><p id="answered" class="status"></p><form id="quizForm">'+COURSE_QUESTIONS.map((q,i)=>'<fieldset class="quiz-question"><legend>'+(i+1)+'. '+h(q[0])+'</legend>'+q[1].map((o,j)=>'<label><input type="radio" required name="q'+i+'" value="'+j+'" '+(quizAnswers[i]===j?'checked':'')+'>'+['А','Б','В'][j]+') '+h(o)+'</label>').join('')+'</fieldset>').join('')+'<button>Завершить и сохранить результат</button><p role="status" aria-live="polite"></p></form><p class="small muted">Не закрывайте и не обновляйте страницу до сохранения результата.</p>';
  const count=()=>{host.querySelector('#answered').textContent='Отвечено: '+quizAnswers.filter(x=>x!==null).length+' из 10';};count();
  host.querySelectorAll('input[type=radio]').forEach(e=>e.onchange=()=>{quizAnswers[+e.name.slice(1)]=+e.value;count();});
  host.querySelector('form').onsubmit=async e=>{
    e.preventDefault();if(quizBusy)return;
    if(quizAnswers.some(x=>x===null)){status('Ответьте на все вопросы.');return;}
    quizBusy=true;const b=e.target.querySelector('button');b.disabled=true;status('Сохраняем результат…');
    try {
      quizResult=await courseApi.rpc('element_submit',{p_token:quizAttempt.token,p_answers:quizAnswers});
      state.done8=true;save();nav();renderQuiz();
    } catch(err) {status(err.message+' Ваши ответы остаются на странице. Повторите отправку.');}
    finally {quizBusy=false;b.disabled=false;}
  };
}
window.addEventListener('beforeunload',e=>{if(quizAttempt&&!quizResult){e.preventDefault();e.returnValue='';}});

