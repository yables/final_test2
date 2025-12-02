require('dotenv').config(); 
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const port = 3001; 

// [수정] 샌드위치 10종에 대한 Mock 데이터 (100g/100ml 기준)
// foodNm: 식품명, enerc: 에너지(kcal), chocdf: 탄수화물(g), prot: 단백질(g), fatce: 지방(g)
// sugars: 당류(g), nat: 나트륨(mg), chole: 콜레스테롤(mg), k: 칼륨(mg), nutConsrtrQua: 기준량
const MOCK_FOOD_DATA = [
    { foodNm: "트위스터 샌드위치", enerc: 56, chocdf: 3.3, prot: 3.6, fatce: 2.96, sugars: 0.68, nat: 124, k: 46, chole: 7, nutConsrtrQua: "100ml" },
    { foodNm: "햄샌드위치", enerc: 185, chocdf: 18.69, prot: 5.3, fatce: 10, sugars: 3.63, nat: 321, k: 100, chole: 65, nutConsrtrQua: "100ml" },
    { foodNm: "감자샐러드 샌드위치", enerc: 108, chocdf: 13.39, prot: 3.1, fatce: 4.73, sugars: 2.27, nat: 217, k: 105, chole: 38, nutConsrtrQua: "100ml" },
    { foodNm: "소고기 샌드위치", enerc: 203, chocdf: 19.7, prot: 6.9, fatce: 10.61, sugars: 2.93, nat: 328, k: 117, chole: 73, nutConsrtrQua: "100ml" },
    { foodNm: "샌드위치_닭고기", enerc: 250, chocdf: 20.89, prot: 16.28, fatce: 11.19, sugars: 3.64, nat: 753, k: 245, chole: 58, nutConsrtrQua: "100g" },
    { foodNm: "샌드위치_생선", enerc: 257, chocdf: 26.69, prot: 10.29, fatce: 12.45, sugars: 3.53, nat: 602, k: 206, chole: 37, nutConsrtrQua: "100g" },
    { foodNm: "샌드위치_소고기", enerc: 244, chocdf: 22.21, prot: 15.17, fatce: 10.3, sugars: 3.84, nat: 653, k: 224, chole: 55, nutConsrtrQua: "100g" },
    { foodNm: "샌드위치_소시지", enerc: 276, chocdf: 23.74, prot: 10.3, fatce: 15.57, sugars: 3.56, nat: 542, k: 145, chole: 45, nutConsrtrQua: "100g" },
    { foodNm: "샌드위치_참치", enerc: 222, chocdf: 14.6, prot: 9.32, fatce: 14.04, sugars: 4.04, nat: 366, k: 148, chole: 53, nutConsrtrQua: "100g" },
    { foodNm: "샌드위치_햄_치즈", enerc: 284, chocdf: 26.95, prot: 8.57, fatce: 15.75, sugars: 4.13, nat: 592, k: 92, chole: 75, nutConsrtrQua: "100g" },
];

// 2. Gemini AI API 설정
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";

const Food_Data = {
  API_KEY: process.env.FOOD_API_KEY, 
  END_POINT: 'https://apis.data.go.kr/openapi/tn_pubr_public_nutri_food_info_api' 
};

app.use(cors({ origin: 'http://localhost:5173' })); 
app.use(express.json());

// --- [기능 1] 음식 영양소 검색 API (Mocking) ---
app.get('/api/food-nutrients', async (req, res) => {
    const { searchName = '' } = req.query; 

    console.log(`🔎 Mock 검색 요청: ${searchName}`);

    const searchTerm = searchName.trim().toLowerCase();
    
    // 검색어가 '샌드위치'를 포함할 경우에만 10개 데이터를 반환 (시연 조건)
    const filteredItems = searchTerm.includes('샌드위치') 
        ? MOCK_FOOD_DATA 
        : MOCK_FOOD_DATA.filter(item => 
            item.foodNm && item.foodNm.toLowerCase().includes(searchTerm)
        );

    // [응답] 프론트엔드에서 요구하는 API 응답 형식에 맞춰 데이터를 가공하여 반환
    const mockResponse = {
        response: {
            header: { resultCode: '00', resultMsg: 'NORMAL SERVICE (MOCK DATA)' },
            body: {
                items: filteredItems,
                item: filteredItems 
            }
        }
    };

    // 50ms 지연을 주어 실제 API 호출처럼 보이게 함
    await new Promise(resolve => setTimeout(resolve, 50)); 
    
    res.json(mockResponse);
});

// --- [기능 2] AI 피드백 API ---
app.post('/api/ai-feedback', async (req, res) => {
    const { logDetails, dailyTotalCalories, dailyRda } = req.body;

    if (!GEMINI_API_KEY) return res.status(500).json({ error: 'Gemini 키 없음' });

    const finalLogText = logDetails.map(log => 
        `- 날짜: ${log.date}, 음식: ${log.food}, 감정: ${log.emotion}, 칼로리: ${log.kcal}kcal`
    ).join('\n');
    
    const userQuery = `[식단 및 감정 기록]\n${finalLogText}\n\n이 기록들을 바탕으로 분석해 줘. 목표 일일 권장 섭취량은 ${dailyRda}kcal 이야.`;

    const systemInstruction = `당신은 영양 심리학자입니다. 사용자의 식단 기록과 감정, 목표 칼로리(${dailyRda}kcal)를 바탕으로 200자 내외로 공감과 격려를 담아 구체적인 영양 심리학적 조언을 해주세요.`;

    try {
        const response = await axios.post(
            `${GEMINI_API_URL}?key=${GEMINI_API_KEY}`,
            {
                contents: [{ parts: [{ text: userQuery }] }],
                config: {
                    systemInstruction: systemInstruction,
                    temperature: 0.7, 
                }
            }
        );
      
        res.json({ feedback: response.data?.candidates?.[0]?.content?.parts?.[0]?.text });

    } catch (error) {
        console.error('❌ Gemini 에러:', error.message);
        res.status(500).json({ error: 'AI 분석 실패: Gemini API 통신 오류' });
    }
});

app.listen(port, () => {
    console.log(`🚀 서버 실행 중: http://localhost:${port}`);
});