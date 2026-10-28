'use strict';
window.courseApi = {
  async request(path, body, token, method = 'POST') {
    const c = window.COURSE_CONFIG || {};
    if (!c.supabaseUrl || !c.supabaseKey) throw new Error('Тест ещё не настроен. Сообщите преподавателю.');
    const url = new URL(c.supabaseUrl);
    if (url.protocol !== 'https:') throw new Error('В настройках требуется HTTPS-адрес Supabase.');
    let response;
    try {
      response = await fetch(url.origin + path, {
        method, headers: {apikey:c.supabaseKey, 'Content-Type':'application/json', ...(token ? {Authorization:'Bearer '+token} : {})},
        ...(body !== undefined ? {body:JSON.stringify(body)} : {}),
        signal: AbortSignal.timeout(20000)
      });
    } catch { throw new Error('Нет связи с базой. Проверьте интернет и повторите отправку.'); }
    let data; try { data = await response.json(); } catch { throw new Error('База вернула непонятный ответ.'); }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error('Нет доступа. Проверьте вход или настройки базы.');
      throw new Error(data.message || data.msg || data.error_description || 'Не удалось выполнить запрос.');
    }
    return data;
  },
  rpc(name, body) { return this.request('/rest/v1/rpc/'+name, body); }
};

