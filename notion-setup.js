// api/notion-setup.js - 신규 사용자 Notion 구조 자동 생성
// 스트리밍 달력, 문서 목록, 게임 목록 DB를 자동으로 만들어줌
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type,Notion-Version');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const auth = req.headers.authorization;
  const nv = '2022-06-28';
  if (!auth) return res.status(401).json({ error: 'Authorization required' });

  const headers = { 'Authorization': auth, 'Notion-Version': nv, 'Content-Type': 'application/json' };
  const call = async (method, path, body) => {
    const r = await fetch(`https://api.notion.com/v1/${path}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined
    });
    return r.json();
  };

  try {
    // 1. 워크스페이스 접근 가능한 페이지 검색
    const search = await call('POST', 'search', {
      filter: { value: 'page', property: 'object' },
      page_size: 1
    });
    if (!search.results?.length) {
      return res.status(400).json({ error: 'No accessible pages. Share at least one page with the integration.' });
    }
    const parentPageId = search.results[0].id;

    // 2. 상위 페이지 생성 (스트리밍 캘린더)
    const rootPage = await call('POST', 'pages', {
      parent: { type: 'page_id', page_id: parentPageId },
      properties: { title: { title: [{ text: { content: '스트리밍 캘린더' } }] } },
      icon: { type: 'emoji', emoji: '🎮' }
    });
    const rootId = rootPage.id;

    // 3. 게임 목록 DB 생성 (다른 DB의 relation에서 참조)
    const gameDb = await call('POST', 'databases', {
      parent: { type: 'page_id', page_id: rootId },
      icon: { type: 'emoji', emoji: '🎮' },
      title: [{ type: 'text', text: { content: '게임 목록' } }],
      properties: {
        '이름': { title: {} },
        '플랫폼': { select: { options: [
          { name: 'HoYoverse', color: 'blue' },
          { name: 'Kuro Games', color: 'green' },
          { name: '기타', color: 'gray' },
        ]}},
      }
    });
    const gameDbId = gameDb.id;

    // 4. 스트리밍 달력 DB 생성
    const calDb = await call('POST', 'databases', {
      parent: { type: 'page_id', page_id: rootId },
      icon: { type: 'emoji', emoji: '📅' },
      title: [{ type: 'text', text: { content: '스트리밍 달력' } }],
      is_inline: true,
      properties: {
        '컨텐츠': { title: {} },
        '날짜': { date: {} },
        '컨텐츠 종류': { multi_select: { options: [
          { name: '방송', color: 'yellow' },
          { name: '합방', color: 'orange' },
          { name: '특별 방송', color: 'green' },
          { name: '업데이트', color: 'blue' },
          { name: '픽업', color: 'pink' },
          { name: '메인 스토리', color: 'purple' },
          { name: '원스동', color: 'red' },
          { name: '개처망한세계', color: 'gray' },
        ]}},
        '버전': { rich_text: {} },
        '상세': { rich_text: {} },
        '컨텐츠 회차': { number: { format: 'number' } },
        '픽업 캐릭터': { rich_text: {} },
        '게임': { relation: { database_id: gameDbId, single_property: {} } },
      }
    });
    const calDbId = calDb.id;

    // 5. 문서 목록 DB 생성
    const docDb = await call('POST', 'databases', {
      parent: { type: 'page_id', page_id: rootId },
      icon: { type: 'emoji', emoji: '📝' },
      title: [{ type: 'text', text: { content: '문서 목록' } }],
      properties: {
        '문서명': { title: {} },
        '분류': { select: { options: [
          { name: '메모', color: 'purple' },
          { name: '대본', color: 'green' },
          { name: '정리', color: 'blue' },
        ]}},
        '게임 목록': { relation: { database_id: gameDbId, single_property: {} } },
        '산출물': { url: {} },
      }
    });
    const docDbId = docDb.id;

    return res.status(200).json({
      success: true,
      rootPageId: rootId,
      calendarDbId: calDbId,
      documentDbId: docDbId,
      gameDbId: gameDbId,
    });
  } catch (e) {
    console.error('setup error:', e);
    return res.status(500).json({ error: e.message });
  }
}
