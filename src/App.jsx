import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, addDoc, onSnapshot, collection, query, serverTimestamp, deleteDoc, writeBatch, getDocs } from 'firebase/firestore';
import axios from 'axios';
import dayjs from 'dayjs';
// [필수] 차트 및 플러그인
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import { Pie } from 'react-chartjs-2';
// import ChartDataLabels from 'chartjs-plugin-datalabels'; 

// 차트 플러그인 등록
ChartJS.register(ArcElement, Tooltip, Legend); 

// --- 상수 및 환경 변수 ---
const KWANGWOON_BURGUNDY = '#800020';
const LIGHT_GRAY = '#f3f4f6';
const LIGHT_BURGUNDY_BORDER = 'rgba(128, 0, 32, 0.3)';
const MEAL_KEYS = ['아침', '점심', '저녁', '간식'];
const EMOTION_OPTIONS = ['선택 안 함', '기쁨', '놀람', '화남', '슬픔', '긴장'];

const ACTIVITY_FACTORS = {
    '안함': 1.2,
    '약간': 1.375,
    '보통': 1.55,
    '적극적': 1.725,
    '매우적극적': 1.9,
};

const GOAL_TYPES = {
    '다이어트': { ratio: [4, 4, 2], factor: -500, description: '체중 감량을 위해 500kcal을 차감한 값입니다.' },
    '유지': { ratio: [4, 3, 3], factor: 1.0, description: '현재 체중을 유지하는 데 필요한 칼로리입니다.' },
    '벌크업': { ratio: [4, 4, 2], factor: 1.1, description: '근육량 증가를 위해 기초대사량의 10%를 추가한 값입니다.' },
};

// [추가] 감정별 분석 문구 및 음식 추천 데이터
const EMOTION_FEEDBACKS = {
    '기쁨': {
        icon: '🎉',
        message: '최근 즐거운 식사가 많네요! 이 긍정적인 흐름을 유지해 보세요.',
        food: '추천: 견과류 (오메가-3), 다크 초콜릿 (기분 유지)',
        color: '#f0f9ff', // light blue
    },
    '놀람': {
        icon: '😮',
        message: '놀라운 감정 기록이 많아요. 예상치 못한 식사였을까요? 감정을 기록하는 습관은 중요합니다!',
        food: '추천: 닭가슴살 샐러드 (단백질 보충), 바나나 (세로토닌 생성)',
        color: '#fffbeb', // light yellow
    },
    '화남': {
        icon: '😡',
        message: '화가 나는 감정과 함께 식사한 경우가 있군요. 잠시 멈추고 심호흡해보세요.',
        food: '추천: 녹차 (L-테아닌), 아보카도 (스트레스 완화)',
        color: '#fef2f2', // light red
    },
    '슬픔': {
        icon: '😢',
        message: '슬픔은 식욕 변화를 가져오기 쉽습니다. 감정을 받아들이고 건강한 위로를 찾아보세요.',
        food: '추천: 통곡물 (탄수화물 위로), 따뜻한 수프 (편안함)',
        color: '#eff6ff', // lighter blue
    },
    '긴장': {
        icon: '😟',
        message: '긴장감은 소화 불량과 폭식을 유발할 수 있습니다. 식사 시에는 충분히 이완하세요.',
        food: '추천: 고구마 (복합 탄수화물), 캐모마일 차 (이완)',
        color: '#f0fdf4', // light green
    },
    '선택 안 함': {
        icon: '❓',
        message: '아직 감정 기록이 부족합니다. 식사 시 어떤 기분이었는지 기록해보세요.',
        food: '추천: 물 마시기 습관, 식사 전 잠시 명상',
        color: '#f3f4f6', // light gray
    },
};


const API_BASE_URL = '';

// --- Firebase 설정 ---
const localFirebaseConfig = {
    apiKey: "AIzaSyC7bb5UMfAULkmzgxZVgAtgPhtDMtxpWKA",
    authDomain: "diet-app-school.firebaseapp.com",
    projectId: "diet-app-school",
    storageBucket: "diet-app-school.firebasestorage.app",
    messagingSenderId: "380036566466",
    appId: "1:380036566466:web:96ec7d4d60889b49959a5b",
    measurementId: "G-1KPP8KD0KP"
};

const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? initialAuthToken : null;

const firebaseConfig = Object.keys(localFirebaseConfig).length > 0 && localFirebaseConfig.apiKey && localFirebaseConfig.apiKey !== 'YOUR_FIREBASE_API_KEY'
    ? localFirebaseConfig 
    : (typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {});

// --- Firebase 초기화 ---
let app, db, auth;
let firebaseInitialized = false;

if (Object.keys(firebaseConfig).length > 0 && firebaseConfig.apiKey) {
    try {
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        firebaseInitialized = true;
    } catch (e) {
        console.error("Firebase 초기화 오류:", e);
    }
} else {
    console.warn("⚠️ Firebase 설정 확인 필요");
}

// --- 유틸리티 함수 ---
const formatDate = (date) => dayjs(date).format('YYYY-MM-DD');
const calculateBMR = (sex, weight, height, age) => {
    if (!weight || !height || !age) return 0;
    return Math.round(sex === '남자' 
        ? (10 * weight) + (6.25 * height) - (5 * age) + 5
        : (10 * weight) + (6.25 * height) - (5 * age) - 161);
};
const calculateTDEE = (bmr, activity) => Math.round(bmr * (ACTIVITY_FACTORS[activity] || 1.2));
const nutrientTotals = (items) => items.reduce((acc, it) => ({
    kcal: acc.kcal + Number(it.kcal || 0),
    carb: acc.carb + Number(it.carbs || 0),
    protein: acc.protein + Number(it.protein || 0),
    fat: acc.fat + Number(it.fat || 0)
}), { kcal: 0, carb: 0, protein: 0, fat: 0 });

// 목표 타입에 따른 최종 목표 칼로리 계산
const calculateGoalRda = (tdee, goalType) => {
    const goal = GOAL_TYPES[goalType];
    let finalRda = tdee;

    if (goal.factor === 1.0) {
        // 체중 유지 (TDEE 그대로)
        finalRda = tdee;
    } else if (goal.factor === 1.1) {
        // 벌크업 (TDEE * 1.1)
        finalRda = tdee * 1.1;
    } else if (goal.factor === -500) {
        // 다이어트 (TDEE - 500)
        finalRda = tdee - 500;
    }
    return Math.max(1200, Math.round(finalRda)); // 최소 칼로리 1200 보장
};


// 매크로 비율 입력 스타일 (경고 스타일 제거)
const getInputStyle = (isError) => ({
    width: '60px', padding: '8px', textAlign: 'center', borderRadius: '8px', 
    border: `2px solid #ddd`, fontSize: '16px', fontWeight: 'bold'
});

// --- 공통 UI 컴포넌트 ---

const LoadingSpinner = () => (
    <div className="flex justify-center p-4">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-900"></div>
    </div>
);

const MacroCircle = ({ label, value, target, color }) => {
    const percent = target > 0 ? Math.round((value / target) * 100) : 0;
    return (
        <div style={{ textAlign: 'center', flex: 1 }}>
            <div style={{
                width: 50, height: 50, borderRadius: '50%', backgroundColor: color, color: 'white',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', margin: '0 auto 5px',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
            }}>{label}</div>
            <div style={{ fontSize: 16, fontWeight: 'bold', color: '#333' }}>{percent}%</div>
            <div style={{ fontSize: 11, color: '#888' }}>{value.toFixed(0)}g / {target}g</div>
        </div>
    );
};

// 입력 카드 (포커스 문제 해결됨)
const InputCard = ({ label, children }) => (
    <div style={{ 
        padding: '12px 15px', border: `1px solid ${LIGHT_BURGUNDY_BORDER}`, borderRadius: '16px', 
        backgroundColor: 'white', boxShadow: '0 2px 5px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column', gap: '5px'
    }}>
        <label style={{ fontWeight: 'bold', fontSize: '14px', color: KWANGWOON_BURGUNDY }}>{label}</label>
        {children}
    </div>
);

// 검색 결과 아이템 (UI 개선: 100g 기준 표시)
const SearchResultItem = ({ item, onSelect }) => {
    const [showDetail, setShowDetail] = useState(false);
    return (
        <div style={{ 
            border: `1px solid #ddd`, borderRadius: '15px', padding: '15px', marginBottom: '10px',
            backgroundColor: 'white', boxShadow: '0 2px 5px rgba(0,0,0,0.05)', position: 'relative'
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                <div>
                    <div style={{ fontWeight: 'bold', fontSize: '16px', color: '#333' }}>
                        {item.name} <span style={{ fontSize: '12px', color: '#888', fontWeight: 'normal' }}>(100g 기준)</span>
                    </div>
                    <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>
                        {item.kcal} kcal 
                        {/* 100g 기준량 표시 */}
                        {item.standardAmt ? ` (기준: ${item.standardAmt})` : ''}
                    </div>
                </div>
                <button 
                    onClick={(e) => { e.stopPropagation(); setShowDetail(!showDetail); }}
                    style={{ fontSize: '11px', padding: '4px 8px', backgroundColor: '#f3f4f6', color: '#555', border: '1px solid #ddd', borderRadius: '12px', cursor: 'pointer' }}
                >
                    {showDetail ? '접기 ▲' : '자세히 ▼'}
                </button>
            </div>

            <div style={{ display: 'flex', gap: '10px', fontSize: '13px', color: '#444' }}>
                <span style={{ color: '#4c9aff', fontWeight: 'bold' }}>탄 {item.carbs}g</span>
                <span style={{ color: '#ff784c', fontWeight: 'bold' }}>단 {item.protein}g</span>
                <span style={{ color: '#ffc300', fontWeight: 'bold' }}>지 {item.fat}g</span>
            </div>

            {showDetail && (
                <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px dashed #eee', fontSize: '12px', color: '#666', display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                    {/* 당류(sugars) 추가, 나트륨/콜레스테롤/칼륨은 기존대로 유지 */}
                    <div>당류: {item.sugars || 0}g</div>
                    <div>콜레스테롤: {item.cholesterol || 0}mg</div>
                    <div>나트륨: {item.sodium || 0}mg</div>
                    <div>칼륨: {item.potassium || 0}mg</div>
                </div>
            )}

            <button onClick={() => onSelect(item)} style={{ width: '100%', marginTop: '10px', padding: '8px', backgroundColor: KWANGWOON_BURGUNDY, color: 'white', borderRadius: '8px', fontWeight: 'bold', fontSize: '13px', border: 'none', cursor: 'pointer' }}>
                선택하기
            </button>
        </div>
    );
};

const Header = () => (
    <div style={{
      position: 'fixed', top: 0, left: '50%', transform: 'translateX(-50%)', maxWidth: '800px', width: '100%', height: '10vh', backgroundColor: KWANGWOON_BURGUNDY, zIndex: 10,
      display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
    }}>
      <h2 style={{ margin: 0 }}>Diet Planner</h2>
    </div>
);

const TabView = ({ currentPage, setCurrentPage, burgundyColor }) => {
    const tabStyle = (isActive) => ({
      flex: 1, padding: '10px 0', textAlign: 'center', cursor: 'pointer',
      borderBottom: `3px solid ${isActive ? burgundyColor : 'transparent'}`,
      color: isActive ? burgundyColor : '#999', fontWeight: isActive ? 'bold' : 'normal',
      transition: 'all 0.3s', backgroundColor: 'white'
    });
    return (
      <div style={{ display: 'flex', marginBottom: 15, borderBottom: '1px solid #ddd' }}>
        {['기록', '통계', '설정'].map(tab => (
            <button key={tab} style={tabStyle(currentPage === tab)} onClick={() => setCurrentPage(tab)}>{tab}</button>
        ))}
      </div>
    );
};

// --- 기능별 컴포넌트 ---

const MealList = ({ items, onRemove }) => {
    if (!items.length) return <div style={{ color: '#999', fontSize: 13, padding: '5px 0' }}>추가된 음식이 없습니다.</div>;
    return (
      <ul style={{ paddingLeft: 0, margin: 0, listStyle: 'none' }}>
        {items.map((it) => (
          <li key={it.id} style={{ marginBottom: 6, fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
            <div>
                <b style={{ marginRight: 5 }}>{it.name}</b> ({it.kcal} kcal)
                <span style={{ marginLeft: 8, color: '#999', fontSize: 11 }}>[{it.emotion}]</span>
            </div>
            <button style={{ marginLeft: 8, padding: '2px 6px', fontSize: 10, backgroundColor: '#a3a3a3', borderRadius: '6px', color: 'white', border: 'none', cursor: 'pointer' }} onClick={() => onRemove(it.id)}>삭제</button>
          </li>
        ))}
      </ul>
    );
};

const MealRecordBlock = ({ mealKey, items, onAdd, onRemove }) => {
    const totals = nutrientTotals(items);
    return (
      <div style={{ border: `1px solid #ccc`, padding: 12, borderRadius: 10, backgroundColor: '#fff' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #eee', paddingBottom: 8, marginBottom: 8 }}>
          <h4 style={{ margin: 0, color: KWANGWOON_BURGUNDY }}>{mealKey}</h4>
          <button onClick={onAdd} style={{ padding: '4px 8px', fontSize: 12, borderRadius: '8px', border: 'none', backgroundColor: KWANGWOON_BURGUNDY, color: 'white', cursor: 'pointer' }}>추가</button>
        </div>
        <MealList items={items} onRemove={onRemove} />
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed #eee', fontSize: 12 }}>
          <div style={{ fontWeight: 'bold' }}>총 {totals.kcal.toFixed(0)} kcal</div>
          <div style={{ color: '#666' }}>탄 {totals.carb.toFixed(0)}g · 단 {totals.protein.toFixed(0)}g · 지 {totals.fat.toFixed(0)}g</div>
        </div>
      </div>
    );
};

const RecordView = ({ date, logs, setEditingMeal, removeFood, userRda, userTdee, goalType, macroRatio, setGoalModalOpen, setDate, showCalendar, setShowCalendar }) => {
    const dailyLogs = logs.filter(log => log.date === date);
    
    const mealData = useMemo(() => {
        const data = MEAL_KEYS.reduce((acc, key) => ({ ...acc, [key]: [] }), {});
        dailyLogs.forEach(log => {
            if (log.mealType && MEAL_KEYS.includes(log.mealType)) {
                data[log.mealType].push(log);
            } else {
                // 구버전 데이터 호환용
                const hour = parseInt(log.time.split(':')[0]);
                let mealKey = '간식';
                // [FIXED] 논리 오류 수정: hour >= 5 && hour < 10
                if (hour >= 5 && hour < 10) mealKey = '아침'; 
                else if (hour >= 10 && hour < 14) mealKey = '점심';
                else if (hour >= 14 && hour < 19) mealKey = '저녁';
                data[mealKey].push(log);
            }
        });
        return data;
    }, [dailyLogs]);

    const { kcal: totalKcal, carb: totalCarb, protein: totalProtein, fat: totalFat } = nutrientTotals(dailyLogs);
    
    // 목표 칼로리에서 탄단지 그램 목표 계산
    const ratioSum = macroRatio.reduce((a, b) => a + b, 0) || 10;
    const targetCarbG = Math.round((userRda * (macroRatio[0] / ratioSum)) / 4);
    const targetProteinG = Math.round((userRda * (macroRatio[1] / ratioSum)) / 4);
    const targetFatG = Math.round((userRda * (macroRatio[2] / ratioSum)) / 9);

    const progressKcal = userRda ? Math.min(100, (totalKcal / userRda) * 100) : 0;

    const gotoOffset = (offset) => {
        setDate(formatDate(dayjs(date).add(offset, 'day')));
        setShowCalendar(false);
    };
    
    const targetRdaText = GOAL_TYPES[goalType]?.description.split(' ')[0] || '';

    return (
        <div style={{ paddingBottom: 20 }}>
            <section style={{ display:'flex', justifyContent:'center', alignItems:'center', marginBottom:20, padding:'10px 0', border:`1px solid ${LIGHT_GRAY}`, borderRadius:10 }}>
                <button onClick={() => gotoOffset(-1)} style={{ padding:'5px 10px', border:'none', background:'transparent', fontSize:'18px', cursor:'pointer' }}>◀</button>
                <div style={{ fontSize:18, fontWeight:'bold', margin:'0 20px', cursor:'pointer' }} onClick={() => setShowCalendar(!showCalendar)}>
                    {date} 📅
                </div>
                <button onClick={() => gotoOffset(1)} style={{ padding:'5px 10px', border:'none', background:'transparent', fontSize:'18px', cursor:'pointer' }}>▶</button>
            </section>

            {showCalendar && (
                <div className="mb-4 p-2 border rounded-lg bg-white shadow-sm">
                    <CalendarView logs={logs} rda={userTdee} onSelectDate={(d) => { setDate(d); setShowCalendar(false); }} />
                </div>
            )}

            <section style={{ textAlign:'center', marginBottom:20, padding:20, borderRadius:15, backgroundColor:'white', boxShadow:'0 2px 8px rgba(0,0,0,0.05)', border: `1px solid ${LIGHT_GRAY}` }}>
                {/* 목표 변경 버튼 추가 */}
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', position: 'relative' }}>
                    <div style={{ fontSize:28, fontWeight:'bold', color:KWANGWOON_BURGUNDY, marginBottom: 5 }}>
                        {totalKcal.toFixed(0)} 
                        <span style={{fontSize:16, color:'#666', marginLeft: 5}}>
                            / {userRda} kcal
                        </span>
                    </div>
                    <button 
                        onClick={() => setGoalModalOpen(true)}
                        style={{
                            position: 'absolute', right: 0, top: 0,
                            padding: '4px 8px', fontSize: 11, backgroundColor: '#f3f4f6', color: KWANGWOON_BURGUNDY, 
                            border: `1px solid ${LIGHT_BURGUNDY_BORDER}`, borderRadius: '10px', cursor: 'pointer'
                        }}
                    >
                        {goalType} 목표 변경
                    </button>
                </div>
                
                <div style={{ marginBottom: 25, padding: '0 10px' }}>
                    <div style={{ fontSize: 12, marginBottom: 5, textAlign: 'right', color: '#888' }}>{progressKcal.toFixed(0)}% 달성</div>
                    <div style={{ height: 12, backgroundColor: '#e5e7eb', borderRadius: 6, overflow: 'hidden' }}>
                        <div style={{ width: `${progressKcal}%`, height: '100%', backgroundColor: KWANGWOON_BURGUNDY, transition: 'width 0.5s ease-in-out' }}></div>
                    </div>
                </div>
                
                {/* 탄단지 비율 표시 */}
                <div style={{ fontSize: 14, fontWeight: 'bold', color: '#444', marginBottom: 15, borderTop: '1px solid #eee', paddingTop: 15 }}>
                    <span style={{ color: '#4c9aff' }}>탄 {macroRatio[0]}</span> : <span style={{ color: '#ff784c' }}>단 {macroRatio[1]}</span> : <span style={{ color: '#ffc300' }}>지 {macroRatio[2]}</span> (비율)
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 10px' }}>
                    <MacroCircle label="탄" value={totalCarb} target={targetCarbG} color="#4c9aff" />
                    <MacroCircle label="단" value={totalProtein} target={targetProteinG} color="#ff784c" />
                    <MacroCircle label="지" value={totalFat} target={targetFatG} color="#ffc300" />
                </div>
            </section>

            <section>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:15 }}>
                    {MEAL_KEYS.map(key => (
                        <MealRecordBlock key={key} mealKey={key} items={mealData[key]} onAdd={() => setEditingMeal(key)} onRemove={removeFood} />
                    ))}
                </div>
            </section>
        </div>
    );
};

// --- 목표 설정 모달 컴포넌트 ---
const GoalSettingModal = ({ onClose, userId, db, userConfig, setUserConfig }) => {
    const [goalType, setGoalType] = useState(userConfig.goalType || '유지');
    const initialMacro = userConfig.macroRatio || GOAL_TYPES[goalType].ratio;
    const [macroRatio, setMacroRatio] = useState(initialMacro);
    
    // 목표 타입 변경 시 매크로 비율 자동 변경
    useEffect(() => {
        const defaultRatio = GOAL_TYPES[goalType].ratio;
        setMacroRatio(defaultRatio);
    }, [goalType]);

    // [수정된 로직] 사용자 입력 시 합이 10이 되도록 자동 조정
    const handleMacroChange = (index, value) => {
        let newValue = Number(value);
        if (newValue < 0) newValue = 0;
        if (newValue > 10) newValue = 10;
        
        const newRatio = [...macroRatio];
        newRatio[index] = newValue;
        
        const currentSum = newRatio.reduce((a, b) => a + b, 0);
        
        if (currentSum > 10) {
            // 합이 10을 초과하면, 탄수화물(0) 또는 단백질(1)에서 초과분을 뺌 (지방은 유지)
            // 우선순위: 단백질(1) > 탄수화물(0)
            const diff = currentSum - 10;
            if (index !== 1 && newRatio[1] >= diff) { // 단백질에서 조정
                newRatio[1] = Math.max(0, newRatio[1] - diff);
            } else if (index !== 0 && newRatio[0] >= diff) { // 탄수화물에서 조정
                newRatio[0] = Math.max(0, newRatio[0] - diff);
            }
        } else if (currentSum < 10) {
            // 합이 10 미만이면, 탄수화물(0) 또는 단백질(1)에 부족분을 더함
            const diff = 10 - currentSum;
            if (index !== 1 && newRatio[1] + diff <= 10) { // 단백질에 추가
                newRatio[1] += diff;
            } else if (index !== 0 && newRatio[0] + diff <= 10) { // 탄수화물에 추가
                newRatio[0] += diff;
            }
        }

        // 모든 값이 0-10 사이인지 확인하고, 소수점은 없도록 Math.round 처리 (사용자 경험 개선)
        const finalRatio = newRatio.map(r => Math.round(Math.max(0, r)));
        
        // 최종 합이 10이 아닐 경우 (보정 후에도 소수점 등 문제로 10이 안될 경우) 가장 큰 값에 남은 차이를 더함
        let finalSum = finalRatio.reduce((a, b) => a + b, 0);
        let adjustmentNeeded = 10 - finalSum;

        if (adjustmentNeeded !== 0) {
            let maxIndex = finalRatio.indexOf(Math.max(...finalRatio));
            finalRatio[maxIndex] += adjustmentNeeded;
        }


        setMacroRatio(finalRatio.map(r => Math.max(0, r)));
    };

    const handleSave = async () => {
        // 저장 시에도 최종 합이 10인지 확인 (방어 코드)
        const finalSum = macroRatio.reduce((a, b) => a + b, 0);
        if (finalSum !== 10) {
            alert('비율의 합이 10이 되도록 조정해 주세요.');
            return;
        }

        const newGoalRda = calculateGoalRda(userConfig.tdee, goalType);
        
        const newConfig = { 
            ...userConfig, 
            goalType, 
            macroRatio, 
            rda: newGoalRda, // 새로운 목표 칼로리 적용
            lastUpdated: serverTimestamp() 
        };
        
        await setDoc(doc(db, 'artifacts', appId, 'users', userId, 'user_config', 'profile'), newConfig, { merge: true });
        setUserConfig(newConfig);
        onClose();
    };

    // 버튼 순서를 다이어트(왼쪽), 유지(가운데), 벌크업(오른쪽)으로 정렬
    const goalOptions = ['다이어트', '유지', '벌크업'];

    return (
        <div style={{ position:'fixed', inset:0, backgroundColor:'rgba(0,0,0,0.5)', display:'flex', justifyContent:'center', alignItems:'center', zIndex:100 }}>
            <div style={{ backgroundColor:'white', padding:20, borderRadius:15, width:360, maxHeight:'80vh', overflowY:'auto' }}>
                <h3 style={{ margin:'0 0 20px 0', color: KWANGWOON_BURGUNDY, textAlign: 'center' }}>목표 설정 변경</h3>
                
                {/* 1. 목표 타입 선택 버튼 (순서 변경 및 스타일 유지) */}
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', marginBottom: '15px' }}>
                    {goalOptions.map(goal => (
                        <button
                            key={goal}
                            onClick={() => setGoalType(goal)}
                            style={{
                                flex: 1, padding: '10px 5px', borderRadius: '12px', border: `2px solid ${KWANGWOON_BURGUNDY}`,
                                backgroundColor: goalType === goal ? KWANGWOON_BURGUNDY : 'white',
                                color: goalType === goal ? 'white' : KWANGWOON_BURGUNDY,
                                fontWeight: 'bold', fontSize: '13px', cursor: 'pointer', transition: 'all 0.2s'
                            }}
                        >
                            {goal}
                        </button>
                    ))}
                </div>
                <p style={{ fontSize: '12px', color: '#666', marginBottom: '20px', textAlign: 'center' }}>
                    {GOAL_TYPES[goalType].description}
                </p>

                {/* 2. 탄단지 비율 설정 */}
                <div style={{ padding: '15px', border: '1px solid #ddd', borderRadius: '12px' }}>
                    {/* 비율합 10 글자 제거 */}
                    <div style={{ fontWeight: 'bold', color: '#333', marginBottom: '10px', textAlign: 'center' }}>탄 : 단 : 지</div>
                    
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}>
                        <input 
                            type="number" 
                            value={macroRatio[0]} 
                            onChange={(e) => handleMacroChange(0, e.target.value)}
                            style={getInputStyle(false)} // 경고창 스타일 제거
                            min="0" max="10" 
                        />
                        <span style={{ fontWeight: 'bold' }}>:</span>
                        <input 
                            type="number" 
                            value={macroRatio[1]} 
                            onChange={(e) => handleMacroChange(1, e.target.value)}
                            style={getInputStyle(false)} // 경고창 스타일 제거
                            min="0" max="10" 
                        />
                        <span style={{ fontWeight: 'bold' }}>:</span>
                        <input 
                            type="number" 
                            value={macroRatio[2]} 
                            onChange={(e) => handleMacroChange(2, e.target.value)}
                            style={getInputStyle(false)} // 경고창 스타일 제거
                            min="0" max="10" 
                        />
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                    <button onClick={onClose} style={{ flex: 1, padding: '12px', backgroundColor: '#e5e7eb', color: '#333', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>취소</button>
                    <button 
                        onClick={handleSave} 
                        // ratioError 체크 제거
                        style={{ flex: 1, padding: '12px', backgroundColor: KWANGWOON_BURGUNDY, color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}
                    >
                        목표 저장
                    </button>
                </div>
                
                <button onClick={onClose} style={{ position:'absolute', top:10, right:10, background:'none', border:'none', fontSize:20, cursor: 'pointer' }}>✕</button>
            </div>
        </div>
    );
};


// --- Firebase 인증 및 초기 프로필 설정 컴포넌트 ---
const ProfileSetup = ({ userId, db, setUserConfig, setGoToMain }) => {
    const [config, setConfig] = useState({ sex: '남자', age: '', height: '', weight: '', activity: '안함' });
    
    const handleSave = async (e) => {
        e.preventDefault();
        if (!userId) return alert('로그인 대기 중...');
        if (!config.age || !config.height || !config.weight) return alert('모든 정보를 입력해주세요.');
        
        const bmr = calculateBMR(config.sex, Number(config.weight), Number(config.height), Number(config.age));
        const tdee = calculateTDEE(bmr, config.activity); // TDEE를 먼저 계산
        
        // 초기 목표는 '유지'로 설정
        const goalType = '유지';
        const macroRatio = GOAL_TYPES[goalType].ratio;
        const rda = calculateGoalRda(tdee, goalType); // TDEE 기반으로 RDA 계산
        
        const finalConfig = { ...config, tdee, rda, goalType, macroRatio, lastUpdated: serverTimestamp() };
        
        await setDoc(doc(db, 'artifacts', appId, 'users', userId, 'user_config', 'profile'), finalConfig);
        setUserConfig(finalConfig);
        setGoToMain(true);
    };

    return (
        <div style={{ padding: 20, paddingTop: '10vh', display: 'flex', justifyContent: 'center' }}>
            <form onSubmit={handleSave} style={{ display: 'grid', gap: 15, width: '100%', maxWidth: 360 }}> 
                <h3 className="text-xl font-bold text-center" style={{ color: KWANGWOON_BURGUNDY, marginBottom: 10 }}>기본 정보 설정</h3>
                <InputCard label="성별">
                    <select name="sex" value={config.sex} onChange={e => setConfig({...config, sex: e.target.value})} style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #eee' }}>
                        <option>남자</option><option>여자</option>
                    </select>
                </InputCard>
                <InputCard label="나이">
                    <input type="number" placeholder="예: 25" value={config.age} onChange={e => setConfig({...config, age: e.target.value})} style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #eee' }} />
                </InputCard>
                <InputCard label="키 (cm)">
                    <input type="number" placeholder="예: 175" value={config.height} onChange={e => setConfig({...config, height: e.target.value})} style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #eee' }} />
                </InputCard>
                <InputCard label="몸무게 (kg)">
                    <input type="number" placeholder="예: 70" value={config.weight} onChange={e => setConfig({...config, weight: e.target.value})} style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #eee' }} />
                </InputCard>
                <InputCard label="활동 수준">
                    <select name="activity" value={config.activity} onChange={e => setConfig({...config, activity: e.target.value})} style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #eee' }}>
                        <option value="안함">운동 안함 (거의 앉아서 생활)</option>
                        <option value="약간">가벼운 활동 (주 1~3회)</option>
                        <option value="보통">보통 활동 (주 3~5회)</option>
                        <option value="적극적">적극적 활동 (주 6~7회)</option>
                        <option value="매우적극적">매우 적극적 (선수급)</option>
                    </select>
                </InputCard>
                <button type="submit" style={{ marginTop: 10, width: '100%', padding: '15px', backgroundColor: KWANGWOON_BURGUNDY, color: 'white', fontWeight: 'bold', borderRadius: '16px', border: 'none', cursor: 'pointer', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
                    시작하기
                </button>
            </form>
        </div>
    );
};

// --- 설정 뷰 컴포넌트 ---
const SettingsView = ({ userId, db, resetProfile }) => {
    const handleReset = async () => {
        // [중요] alert/confirm 대신 커스텀 모달이 필요하지만, 시연을 위해 임시로 유지
        if (!window.confirm('정말로 초기화하시겠습니까?')) return;
        try {
            const q = query(collection(db, 'artifacts', appId, 'users', userId, 'diet_logs'));
            const snapshot = await getDocs(q);
            const batch = writeBatch(db);
            snapshot.docs.forEach(doc => batch.delete(doc.ref));
            batch.delete(doc(db, 'artifacts', appId, 'users', userId, 'user_config', 'profile'));
            await batch.commit();
            window.alert('초기화되었습니다.');
            resetProfile();
        } catch (e) {
            console.error(e);
            window.alert('초기화 실패');
        }
    };
    return (
        <div style={{ padding: 20, textAlign: 'center' }}>
            <h2 style={{ color: KWANGWOON_BURGUNDY }}>⚙️ 설정</h2>
            <p style={{ color: '#666', margin: '20px 0' }}>데이터 초기화 및 프로필 재설정</p>
            <button onClick={handleReset} style={{ padding: '15px 30px', backgroundColor: '#ef4444', color: 'white', border: 'none', borderRadius: 10, fontSize: 16, cursor: 'pointer' }}>⚠️ 데이터 전체 초기화</button>
        </div>
    );
};

// --- 달력 컴포넌트 ---
const CalendarView = ({ logs, rda, onSelectDate, initialDisplayMonth, onMonthChange }) => {
    // initialDisplayMonth가 제공되면 그것을 사용, 아니면 현재 월 사용
    const [displayMonth, setDisplayMonth] = useState(initialDisplayMonth || dayjs().startOf('month'));
    const today = dayjs();

    // props로 displayMonth를 받은 경우, 내부 상태 대신 props를 사용하도록 변경
    useEffect(() => {
        if (initialDisplayMonth && !displayMonth.isSame(initialDisplayMonth, 'month')) {
            setDisplayMonth(initialDisplayMonth);
        }
    }, [initialDisplayMonth]);


    const currentMonth = displayMonth.startOf('month');
    const startDayOfMonth = currentMonth.startOf('week');

    const calendarDays = useMemo(() => {
        const days = [];
        let day = startDayOfMonth;
        
        // 6주치 달력 생성
        for (let i = 0; i < 42; i++) { 
            days.push(day);
            day = day.add(1, 'day');
        }
        return days;
    }, [displayMonth]);

    const dailyStats = useMemo(() => {
        const stats = {};
        logs.forEach(log => {
            if (!stats[log.date]) stats[log.date] = 0;
            stats[log.date] += Number(log.kcal);
        });
        return stats;
    }, [logs]);

    const getTileStyle = (kcal) => {
        if (!kcal) return { bg: '#f3f4f6', text: 'black' };
        const ratio = kcal / rda; 
        if (ratio > 1.2) return { bg: '#fee2e2', text: '#ef4444' }; // 과식(빨강)
        if (ratio < 0.8) return { bg: '#fef3c7', text: '#d97706' }; // 부족(노랑)
        return { bg: '#dcfce7', text: '#16a34a' }; // 적정(초록)
    };
    
    // 월 이동 함수 수정: onMonthChange 콜백 함수 사용
    const prevMonth = () => {
        const newMonth = displayMonth.subtract(1, 'month');
        setDisplayMonth(newMonth);
        if (onMonthChange) onMonthChange(newMonth);
    };
    const nextMonth = () => {
        const newMonth = displayMonth.add(1, 'month');
        setDisplayMonth(newMonth);
        if (onMonthChange) onMonthChange(newMonth);
    };

    return (
        <div style={{ width: '100%' }}>
            {/* 월 이동 헤더 추가 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, padding: '0 10px' }}>
                <button onClick={prevMonth} style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: KWANGWOON_BURGUNDY }}>&#9664;</button>
                <div style={{ fontWeight: 'bold', fontSize: '16px' }}>
                    {displayMonth.format('YYYY년 MM월')}
                </div>
                <button onClick={nextMonth} style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: KWANGWOON_BURGUNDY }}>&#9654;</button>
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', textAlign: 'center', marginBottom: 5, fontSize: 12, color: '#888' }}>
                {['일','월','화','수','목','금','토'].map(d => <div key={d}>{d}</div>)}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
                {calendarDays.map((date, idx) => {
                    const dateStr = formatDate(date);
                    const kcal = dailyStats[dateStr];
                    const isToday = dateStr === today.format('YYYY-MM-DD');
                    const { bg, text } = getTileStyle(kcal);
                    const isCurrentMonth = date.month() === currentMonth.month();

                    return (
                        <div 
                            key={idx} 
                            onClick={() => onSelectDate && onSelectDate(dateStr)} 
                            style={{ 
                                backgroundColor: bg, 
                                color: isCurrentMonth ? text : '#ccc', // 현재 월이 아니면 흐리게
                                opacity: isCurrentMonth ? 1 : 0.6,
                                border: isToday ? `2px solid ${KWANGWOON_BURGUNDY}` : 'none', 
                                borderRadius: '8px', minHeight: '60px', padding: '4px',
                                cursor: 'pointer', display: 'flex', flexDirection: 'column', justifyContent: 'space-between'
                            }}
                        >
                            <div style={{ fontWeight: 'bold', fontSize: '12px' }}>{date.date()}</div>
                            {kcal > 0 && <div style={{ fontSize: '10px', fontWeight: 'bold' }}>{kcal.toFixed(0)} kcal</div>}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

// [검색 로직 수정] 표준 데이터 API 변수명 사용 (foodNm) + 저장 오류 방지
const FoodAddContainerModal = ({ onClose, onAddFood, targetMeal }) => {
    const [mode, setMode] = useState('select'); 
    const [queryText, setQueryText] = useState('');
    const [results, setResults] = useState([]);
    const [manualForm, setManualForm] = useState({ name: '', kcal: '', carbs: '', protein: '', fat: '' });
    const [emotion, setEmotion] = useState(EMOTION_OPTIONS[0]);

    const handleSearch = async () => {
        try {
            // [API Mocking] 백엔드 Mock API를 호출하여 검색 시뮬레이션
            const res = await axios.get(`${API_BASE_URL}/api/food-nutrients?searchName=${queryText}`);
            
            // 공공데이터 포털 API의 응답 구조를 Mock 서버에서 가정하고 처리합니다.
            // Mock 서버 응답 구조: res.data.response?.body?.items
            const items = res.data.response?.body?.items || [];
            
            // Mock 데이터는 이미 API 변수명(foodNm, enerc 등)을 따르고 있으므로, 그대로 매핑합니다.
            const mappedItems = items.map(i => ({
                name: i.foodNm,                 
                kcal: Number(i.enerc || 0),     
                carbs: Number(i.chocdf || 0),   
                protein: Number(i.prot || 0),   
                fat: Number(i.fatce || 0),      
                
                // 상세 정보
                cholesterol: Number(i.chole || 0), 
                sodium: Number(i.nat || 0),        
                potassium: Number(i.k || 0),       
                sugars: Number(i.sugars || 0), // 당류 추가
                
                standardAmt: i.nutConsrtrQua || '', // 기준량   
                maker: i.entrpsNm || '', // 제조사
                origin: i.foodOriginNm || '' // 출처(외식/가정식 등)
            }));

            // 중복 제거 및 우선순위 (Mock 데이터이므로 단순화)
            const grouped = {};
            mappedItems.forEach(item => {
                const name = item.name;
                if (!grouped[name]) grouped[name] = [];
                grouped[name].push(item);
            });

            const filteredList = Object.values(grouped).map(group => {
                if (group.length === 1) return group[0];
                
                const outdoor = group.find(i => i.origin?.includes('외식'));
                if (outdoor) return outdoor;
                
                const home = group.find(i => i.origin?.includes('가정식'));
                if (home) return home;

                return group[0];
            });


            setResults(filteredList);
            setMode('searchResult');
        } catch (error) { 
            // 500 오류 대신 Mocking 서버 응답을 받게 되므로 이 블록은 실행되지 않아야 합니다.
            console.error('검색 중 Mocking 서버 오류:', error);
            alert('검색 시뮬레이션에 오류가 발생했습니다. 콘솔을 확인해주세요.'); 
        }
    };

    const handleSave = (data) => {
        // [중요] 저장 시 undefined 방지 (저장 오류 해결)
        const safeData = {
            ...data,
            name: data.name || '이름 없음',
            kcal: Number(data.kcal) || 0,
            carbs: Number(data.carbs) || 0,
            protein: Number(data.protein) || 0,
            fat: Number(data.fat) || 0,
            emotion,
            time: dayjs().format('HH:mm'),
            mealType: targetMeal 
        };
        onAddFood(safeData);
        onClose();
    };

    return (
        <div style={{ position:'fixed', inset:0, backgroundColor:'rgba(0,0,0,0.5)', display:'flex', justifyContent:'center', alignItems:'center', zIndex:100 }}>
            <div style={{ backgroundColor:'white', padding:20, borderRadius:15, width:360, maxHeight:'80vh', overflowY:'auto' }}>
                <h3 style={{ margin:'0 0 15px 0', color:KWANGWOON_BURGUNDY }}>{targetMeal}에 음식 추가</h3>
                
                {mode === 'select' && (
                    <div style={{ display:'grid', gap:10 }}>
                        <div style={{ display: 'flex', gap: 5 }}>
                            {/* [수정] 플레이스홀더 텍스트 변경 */}
                            <input className="p-2 border rounded w-full" placeholder="음식 검색 (예: 현미밥)" value={queryText} onChange={e=>setQueryText(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearch()} />
                            <button onClick={handleSearch} className="p-2 bg-gray-200 rounded" style={{ whiteSpace: 'nowrap' }}>검색</button>
                        </div>
                        <div className="text-center my-2 text-sm text-gray-400">- 또는 -</div>
                        <button onClick={() => setMode('manual')} className="p-3 border rounded text-left font-bold">✏️ 직접 입력하기</button>
                    </div>
                )}

                {mode === 'searchResult' && (
                    <div className="space-y-2">
                        {results.length > 0 ? (
                            results.map((item, i) => <SearchResultItem key={i} item={item} onSelect={handleSave} />)
                        ) : (
                            <div style={{ textAlign: 'center', padding: '20px', color: '#999' }}>검색 결과가 없습니다. (.)</div>
                        )}
                        <button onClick={() => setMode('select')} className="w-full mt-2 text-sm text-gray-500 underline bg-transparent border-none cursor:pointer">뒤로가기</button>
                    </div>
                )}

                {mode === 'manual' && (
                    <div className="space-y-2">
                        <input className="w-full p-2 border rounded" placeholder="음식명" value={manualForm.name} onChange={e=>setManualForm({...manualForm, name:e.target.value})} />
                        <div className="grid grid-cols-2 gap-2">
                            <input type="number" className="p-2 border rounded" placeholder="칼로리" value={manualForm.kcal} onChange={e=>setManualForm({...manualForm, kcal:e.target.value})} />
                            <input type="number" className="p-2 border rounded" placeholder="탄수화물" value={manualForm.carbs} onChange={e=>setManualForm({...manualForm, carbs:e.target.value})} />
                            <input type="number" className="p-2 border rounded" placeholder="단백질" value={manualForm.protein} onChange={e=>setManualForm({...manualForm, protein:e.target.value})} />
                            <input type="number" className="p-2 border rounded" placeholder="지방" value={manualForm.fat} onChange={e=>setManualForm({...manualForm, fat:e.target.value})} />
                        </div>
                        <select className="w-full p-2 border rounded mt-2" value={emotion} onChange={e=>setEmotion(e.target.value)}>
                            {EMOTION_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                        <div className="flex gap-2 mt-4">
                            <button onClick={() => setMode('select')} className="flex-1 p-2 bg-gray-200 rounded">취소</button>
                            <button onClick={() => handleSave(manualForm)} className="flex-1 p-2 bg-red-800 text-white rounded">저장</button>
                        </div>
                    </div>
                )}
                <button onClick={onClose} style={{ position:'absolute', top:10, right:10, background:'none', border:'none', fontSize:20, cursor: 'pointer' }}>✕</button>
            </div>
        </div>
    );
};

// --- 통계 뷰 컴포넌트 ---
const StatsContainerView = ({ logs, rda, userId, userConfig }) => {
    // [추가] 통계 뷰에서 선택된 월을 관리하는 상태
    const [statsDisplayMonth, setStatsDisplayMonth] = useState(dayjs().startOf('month'));
    const macroRatio = userConfig?.macroRatio || GOAL_TYPES['유지'].ratio;

    // [수정] 통계 기준 월의 시작일과 종료일 계산
    const startOfMonth = statsDisplayMonth.startOf('month').startOf('day');
    const endOfMonth = statsDisplayMonth.endOf('month').endOf('day');

    // [수정] 선택된 월의 로그만 필터링합니다.
    const monthlyLogs = useMemo(() => {
        return logs.filter(log => {
            const logDate = dayjs(log.date);
            return logDate.isAfter(startOfMonth.subtract(1, 'day')) && logDate.isBefore(endOfMonth.add(1, 'day'));
        });
    }, [logs, statsDisplayMonth]);

    // 월별 데이터 통계 집계 (고유 일수 계산 포함)
    const monthlyStats = useMemo(() => {
        const stats = nutrientTotals(monthlyLogs);
        const uniqueDates = new Set(monthlyLogs.map(log => log.date)).size;
        const days = uniqueDates || 1; // 0 나누기 방지

        // 월별 일일 평균값 계산
        const avgKcal = stats.kcal / days;
        const avgCarb = stats.carb / days;
        const avgProtein = stats.protein / days;
        const avgFat = stats.fat / days;

        return { 
            avgKcal, 
            avgCarb, 
            avgProtein, 
            avgFat, 
            uniqueDays: uniqueDates,
            // 총합 데이터 (분석 로직용)
            totalKcal: stats.kcal,
            totalCarb: stats.carb,
            totalProtein: stats.protein,
            totalFat: stats.fat
        };
    }, [monthlyLogs]);

    // 차트 데이터는 평균 일일 섭취량을 기준으로 합니다.
    const avgKcal = monthlyStats.avgKcal;
    const avgCarb = monthlyStats.avgCarb;
    const avgProtein = monthlyStats.avgProtein;
    const avgFat = monthlyStats.avgFat;
    const uniqueDays = monthlyStats.uniqueDays;

    const emotionCounts = monthlyLogs.reduce((acc, log) => {
        const emo = log.emotion || '선택 안 함';
        acc[emo] = (acc[emo] || 0) + 1;
        return acc;
    }, {});

    // [추가] 최다 기록 감정 및 분석 결과 계산 (로직 유지)
    const mostFrequentEmotion = useMemo(() => {
        let maxCount = -1;
        let emotion = '선택 안 함';
        
        Object.entries(emotionCounts).forEach(([emo, count]) => {
            if (emo !== '선택 안 함' && count > maxCount) {
                maxCount = count;
                emotion = emo;
            }
        });
        
        const totalMeaningfulRecords = Object.entries(emotionCounts).reduce((sum, [emo, count]) => sum + (emo === '선택 안 함' ? 0 : count), 0);
        
        if (totalMeaningfulRecords === 0) {
            return '선택 안 함';
        }

        return emotion;
    }, [emotionCounts]);

    const analysis = EMOTION_FEEDBACKS[mostFrequentEmotion];
    
    // [추가] 매크로 목표 달성 현황 분석 (평균값을 사용하여 분석)
    const macroAnalysis = useMemo(() => {
        if (avgKcal === 0) return '이번 달 기록이 없어 영양 목표를 분석할 수 없습니다.';
        
        // 총 섭취 칼로리 대비 비율 (0.x -> 100% 기준)
        const totalEnergyFromMacros = (avgCarb * 4) + (avgProtein * 4) + (avgFat * 9);
        const totalKcalToUse = totalEnergyFromMacros || 1; // 0 나누기 방지
        
        const actualCarbRatio = Math.round(((avgCarb * 4) / totalKcalToUse) * 10);
        const actualProteinRatio = Math.round(((avgProtein * 4) / totalKcalToUse) * 10);
        const actualFatRatio = Math.round(((avgFat * 9) / totalKcalToUse) * 10);
        
        const actualRatios = [actualCarbRatio, actualProteinRatio, actualFatRatio];
        const targetRatios = macroRatio; // [탄:단:지] 4:3:3 (총 10 기준)
        
        let feedback = `설정 목표 비율은 ${targetRatios[0]}:${targetRatios[1]}:${targetRatios[2]}입니다. 실제 평균 비율은 ${actualRatios[0]}:${actualRatios[1]}:${actualRatios[2]}입니다.`;
        let adjustmentNeeded = [];

        // 비율 편차 허용 범위 설정 (예: 목표 비율의 15% 이상 차이 시 경고)
        const checkDeviation = (actual, target, nutrient) => {
            const deviationThreshold = Math.max(1, Math.ceil(target * 0.15)); // 최소 1, 목표의 15% 이상 차이
            if (actual > target + deviationThreshold) {
                adjustmentNeeded.push(`${nutrient} 섭취가 **과다**합니다. (${target} 대비 ${actual})`);
            } else if (actual < target - deviationThreshold) {
                adjustmentNeeded.push(`${nutrient} 섭취가 **부족**합니다. (${target} 대비 ${actual})`);
            }
        };

        checkDeviation(actualRatios[0], targetRatios[0], '탄수화물');
        checkDeviation(actualRatios[1], targetRatios[1], '단백질');
        checkDeviation(actualRatios[2], targetRatios[2], '지방');

        if (adjustmentNeeded.length === 0) {
            feedback = `✨ 월별 탄단지 섭취 비율이 목표 비율 (${targetRatios[0]}:${targetRatios[1]}:${targetRatios[2]})에 매우 가깝게 잘 유지되고 있습니다!`;
        } else {
            feedback = `⚠️ 이번 달 영양소 균형에 조정이 필요합니다.`;
            feedback += adjustmentNeeded.map(a => `\n- ${a}`).join('');
        }
        
        return feedback;
    }, [avgKcal, avgCarb, avgProtein, avgFat, macroRatio]); // avg 값을 의존성 배열에 추가


    // [핵심] 차트 옵션: 그래프 위엔 %, 툴팁엔 실제 값
    const chartOptions = {
        plugins: {
            legend: {
                position: 'bottom',
                labels: { font: { size: 11 } }
            },
            tooltip: {
                callbacks: {
                    label: function(context) {
                        const label = context.label || '';
                        const value = context.raw || 0;
                        return `${label}: ${value.toFixed(1)}g`; // g 단위로 표시
                    }
                }
            }
        }
    };

    const macroData = {
        labels: ['탄수화물', '단백질', '지방'],
        datasets: [{
            data: [avgCarb, avgProtein, avgFat], // 평균값 사용
            backgroundColor: ['#4c9aff', '#ff784c', '#ffc300'],
            borderWidth: 1,
        }]
    };

    const emotionData = {
        labels: Object.keys(emotionCounts),
        datasets: [{
            data: Object.values(emotionCounts),
            backgroundColor: ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#C9CBCF'],
            borderWidth: 1,
        }]
    };

    return (
        <div style={{ padding: 20, backgroundColor: 'white', borderRadius: 15 }}>
            <h2 style={{ color: KWANGWOON_BURGUNDY, borderBottom: '2px solid #eee', paddingBottom: 10 }}>📊 {statsDisplayMonth.format('YYYY년 MM월')} 통계</h2>
            
            {/* [추가] 통계 뷰에 달력 다시 추가 */}
            <div style={{ marginTop: 20, marginBottom: 20 }}>
                <h3 style={{ margin: '0 0 10px 0', fontSize: '16px', fontWeight: 'bold' }}>📅 통계 기준 월 선택</h3>
                <CalendarView 
                    logs={logs} 
                    rda={rda} 
                    onSelectDate={(d) => { 
                        setStatsDisplayMonth(dayjs(d).startOf('month')); 
                    }} 
                    initialDisplayMonth={statsDisplayMonth}
                    onMonthChange={setStatsDisplayMonth}
                />
            </div>

            <div style={{ marginTop: 30, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                <div>
                    {/* [수정] 총 칼로리 표시 제거 및 평균 칼로리 강조 */}
                    <h4 className="text-center text-sm font-bold mb-2">선택 월 탄단지 (평균 {avgKcal.toFixed(0)}kcal)</h4> 
                    <Pie data={macroData} options={chartOptions} />
                </div>
                <div>
                    <h4 className="text-center text-sm font-bold mb-2">선택 월 감정 기록 (총 {monthlyLogs.length}건)</h4>
                    <Pie data={emotionData} options={chartOptions} />
                </div>
            </div>

            {/* [수정] AI 분석 결과를 감정 기반의 Mock 결과로 대체 */}
            <div style={{ marginTop: 30, padding: 20, backgroundColor: analysis.color, borderRadius: 15, border: '1px solid #ccc' }}>
                <h3 style={{ color: KWANGWOON_BURGUNDY, margin: '0 0 15px 0', borderBottom: `1px solid ${KWANGWOON_BURGUNDY}`, paddingBottom: 10 }}>📊 월별 심리 영양 분석</h3>
                
                {/* 1. 심리 분석 */}
                <div style={{ marginBottom: 20 }}>
                    <div style={{ fontWeight: 'bold', color: '#db2777', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <span style={{ fontSize: '1.2em' }}>📌</span> 가장 많이 나타난 감정: {mostFrequentEmotion}
                    </div>
                    <p style={{ fontSize: 14, color: '#444', marginBottom: 10, lineHeight: 1.6, paddingLeft: 20 }}>
                        {analysis.icon} {analysis.message}
                    </p>
                    <div style={{ fontSize: 13, color: '#666', paddingTop: 5, paddingLeft: 20 }}>
                        **추천 영양소/음식:** {analysis.food}
                    </div>
                </div>
                
                {/* 2. 영양 목표 분석 */}
                <div>
                    <div style={{ fontWeight: 'bold', color: '#4c9aff', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <span style={{ fontSize: '1.2em' }}>🎯</span> 영양 목표 달성 현황
                    </div>
                    <p style={{ whiteSpace: 'pre-wrap', fontSize: 14, color: '#444', lineHeight: 1.6, paddingLeft: 20 }}>
                        {macroAnalysis}
                    </p>
                </div>
            </div>
        </div>
    );
};

// --- 메인 App 컴포넌트 ---
export default function App() {
    const [userId, setUserId] = useState(null);
    const [userConfig, setUserConfig] = useState(null);
    const [logs, setLogs] = useState([]);
    const [activeTab, setActiveTab] = useState('기록');
    const [isAddModalOpen, setIsAddModalOpen] = useState(false); 
    const [isGoalModalOpen, setGoalModalOpen] = useState(false); // 목표 설정 모달 상태 추가
    const [goToMain, setGoToMain] = useState(false);
    const [currentDate, setCurrentDate] = useState(formatDate(dayjs()));
    const [showCalendar, setShowCalendar] = useState(false);

    useEffect(() => {
        if (!firebaseInitialized) return;
        const init = async () => {
            initialAuthToken ? await signInWithCustomToken(auth, initialAuthToken) : await signInAnonymously(auth);
        };
        init();
        return onAuthStateChanged(auth, user => {
            setUserId(user?.uid);
            if (user?.uid) {
                onSnapshot(doc(db, 'artifacts', appId, 'users', user.uid, 'user_config', 'profile'), d => {
                    // Firebase에서 목표 타입 및 비율을 가져오기. 없으면 기본값 설정
                    const savedData = d.exists() ? d.data() : {};
                    const goalType = savedData.goalType || '유지';
                    const macroRatio = savedData.macroRatio || GOAL_TYPES['유지'].ratio;
                    
                    setUserConfig({ 
                        ...savedData, 
                        goalType, 
                        macroRatio,
                        // TDEE만 있다면 RDA를 재계산 (구 버전 호환성 및 목표변경 로직 준비)
                        rda: savedData.tdee ? calculateGoalRda(savedData.tdee, goalType) : savedData.rda 
                    });
                    
                    if (d.exists() && savedData.rda) setGoToMain(true);
                });
                onSnapshot(query(collection(db, 'artifacts', appId, 'users', user.uid, 'diet_logs')), s => {
                    setLogs(s.docs.map(d => ({ id: d.id, ...d.data(), mealType: d.data().mealType || '' })));
                });
            }
        });
    }, []);

    const handleRemoveLog = async (id) => {
        await deleteDoc(doc(db, 'artifacts', appId, 'users', userId, 'diet_logs', id));
    };

    const handleAddLog = async (data) => {
        try {
            await addDoc(collection(db, 'artifacts', appId, 'users', userId, 'diet_logs'), {
                ...data, date: currentDate, timestamp: serverTimestamp()
            });
        } catch (e) {
            console.error("저장 실패:", e);
            alert("저장 중 오류가 발생했습니다.");
        }
    };
    
    // 로딩 처리
    if (!firebaseInitialized || !userId) return <LoadingSpinner />;

    // 설정 값이 로드되지 않았거나 RDA/TDEE가 없는 경우 ProfileSetup 표시
    const requiresSetup = !userConfig || !userConfig.rda || !userConfig.tdee || !goToMain;

    return (
        <div className="app-root">
            <div className="app-container">
                <Header />
                {requiresSetup ? (
                    <ProfileSetup userId={userId} db={db} setUserConfig={setUserConfig} setGoToMain={setGoToMain} />
                ) : (
                    <div style={{ paddingTop: '10vh', paddingLeft: 20, paddingRight: 20, flex: 1 }}>
                        <TabView currentPage={activeTab} setCurrentPage={setActiveTab} burgundyColor={KWANGWOON_BURGUNDY} />
                        {activeTab === '기록' && (
                            <RecordView 
                                date={currentDate} 
                                logs={logs} 
                                setEditingMeal={setIsAddModalOpen} 
                                removeFood={handleRemoveLog} 
                                userRda={userConfig.rda}
                                userTdee={userConfig.tdee}
                                goalType={userConfig.goalType} // 목표 타입 전달
                                macroRatio={userConfig.macroRatio} // 매크로 비율 전달
                                setGoalModalOpen={setGoalModalOpen} // 모달 열기 함수 전달
                                showCalendar={showCalendar}
                                setShowCalendar={setShowCalendar}
                                setDate={setCurrentDate}
                            />
                        )}
                        {activeTab === '통계' && (
                            <StatsContainerView logs={logs} rda={userConfig.rda} userId={userId} userConfig={userConfig} />
                        )}
                        {activeTab === '설정' && (
                            <SettingsView userId={userId} db={db} resetProfile={() => setGoToMain(false)} />
                        )}
                    </div>
                )}
            </div>
            {isAddModalOpen && (
                <FoodAddContainerModal 
                    targetMeal={isAddModalOpen} 
                    onClose={() => setIsAddModalOpen(false)} 
                    onAddFood={handleAddLog} 
                />
            )}
            {/* 목표 설정 모달 추가 */}
            {isGoalModalOpen && (
                 <GoalSettingModal 
                    onClose={() => setGoalModalOpen(false)}
                    userId={userId}
                    db={db}
                    userConfig={userConfig}
                    setUserConfig={setUserConfig}
                 />
            )}
            
            <style>{`
                body {
                    margin: 0; padding: 0; background-color: ${LIGHT_GRAY};
                    min-height: 100vh; display: flex; justify-content: center;
                }
                #root, .app-root { width: 100%; display: flex; justify-content: center; }
                .app-container {
                    width: 100%; max-width: 800px; background-color: white;
                    min-height: 100vh; box-shadow: 0 0 20px rgba(0,0,0,0.1);
                    position: relative; display: flex; flex-direction: column;
                }
                ::-webkit-scrollbar { width: 8px; }
                ::-webkit-scrollbar-thumb { background: #ccc; borderRadius: 4px; }
            `}</style>
        </div>
    );
}