'use client';

import { useState, useEffect } from 'react';
import Papa from 'papaparse';

// 型定義
type Question = {
  question: string;
  option1: string;
  option2: string;
  option3: string;
  option4: string;
  answer: string;
  explanation: string;
};

type HistoryItem = {
  date: string;
  score: number;
  total: number;
  mode: string; // "10問モード" など
};

// 配列をシャッフルする関数（フィッシャー–イェーツのシャッフル）
const shuffleArray = <T,>(array: T[]): T[] => {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
};

export default function Home() {
  // --- 状態管理 ---
  // 画面の状態: 'loading' | 'menu' | 'quiz' | 'result'
  const [gameState, setGameState] = useState<'loading' | 'menu' | 'quiz' | 'result'>('loading');
  
  // データ関連
  const [allQuestions, setAllQuestions] = useState<Question[]>([]); // 全データ
  const [activeQuestions, setActiveQuestions] = useState<Question[]>([]); // 実際に解く問題セット
  const [history, setHistory] = useState<HistoryItem[]>([]); // 受験履歴

  // クイズ進行
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [solvedQuestions, setSolvedQuestions] = useState<Set<number>>(new Set()); // 正解した問題のインデックス

  // 設定
  const [selectedCount, setSelectedCount] = useState<number>(10); // デフォルト10問

  const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQyTaqBFKydSZeEcF8bJeYg95H_yfr1LcfeypU2ojVoTHxl2J9mJcacVRuu3u5MEmieYum_Pedg_Ptu/pub?gid=2142520007&single=true&output=csv';

  // --- 初期化 ---
  useEffect(() => {
    // CSV読み込み
    Papa.parse(SHEET_URL, {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const data = results.data as Question[];
        if (data.length > 0) {
          setAllQuestions(data);
        }
        setGameState('menu');
      },
      error: (err) => {
        console.error("CSV error:", err);
        setGameState('menu'); // エラーでも一旦メニューへ（エラー表示はUIで行う）
      }
    });

    // 履歴の読み込み（ローカルストレージ）
    const savedHistory = localStorage.getItem('quiz_history');
    if (savedHistory) {
      setHistory(JSON.parse(savedHistory));
    }
  }, []);

  // --- 機能関数 ---

  // クイズ開始処理
  const startQuiz = () => {
    // シャッフルして、指定された問題数だけ切り出す
    let questionsToPlay = shuffleArray(allQuestions);
    
    // 「全て」が選ばれていない場合のみスライス
    if (selectedCount > 0 && selectedCount < questionsToPlay.length) {
      questionsToPlay = questionsToPlay.slice(0, selectedCount);
    }

    setActiveQuestions(questionsToPlay);
    setCurrentIndex(0);
    setSolvedQuestions(new Set());
    setIsCorrect(null);
    setGameState('quiz');
  };

  // 回答処理
  const handleAnswer = (selectedOptionIndex: number) => {
    if (isCorrect !== null) return;

    const selectedNumber = String(selectedOptionIndex + 1);
    const correctNumber = activeQuestions[currentIndex].answer;
    const result = selectedNumber === correctNumber;
    
    setIsCorrect(result);

    if (result) {
      setSolvedQuestions(prev => {
        const newSet = new Set(prev);
        newSet.add(currentIndex);
        return newSet;
      });
    }
  };

  // 次へ / 前へ
  const handleNext = () => {
    setIsCorrect(null);
    const nextIndex = currentIndex + 1;
    if (nextIndex < activeQuestions.length) {
      setCurrentIndex(nextIndex);
    } else {
      finishQuiz();
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setIsCorrect(null);
      setCurrentIndex(currentIndex - 1);
    }
  };

  // 終了・履歴保存処理
  const finishQuiz = () => {
    const score = solvedQuestions.size;
    const total = activeQuestions.length;
    
    // 履歴オブジェクト作成
    const newHistoryItem: HistoryItem = {
      date: new Date().toLocaleString('ja-JP'),
      score: score,
      total: total,
      mode: total === allQuestions.length ? "全問" : `${total}問`
    };

    // 履歴更新（最新を先頭に）
    const newHistory = [newHistoryItem, ...history].slice(0, 50); // 最大50件保存
    setHistory(newHistory);
    localStorage.setItem('quiz_history', JSON.stringify(newHistory));

    setGameState('result');
  };

  // メニューに戻る
  const backToMenu = () => {
    setGameState('menu');
  };

  // --- 表示用変数 ---
  const currentScore = solvedQuestions.size;
  const currentQ = activeQuestions[currentIndex];

  // 読み込み中
  if (gameState === 'loading') {
    return <div className="flex h-screen items-center justify-center text-gray-600 font-bold">データを読み込んでいます...</div>;
  }

  // --- 画面描画 ---
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gray-50 p-4 text-gray-800 font-sans">
      <div className="w-full max-w-2xl bg-white p-6 md:p-10 rounded-xl shadow-xl border border-gray-100">
        
        {/* === メニュー画面 === */}
        {gameState === 'menu' && (
          <div className="text-center">
            <h1 className="text-3xl md:text-4xl font-black text-blue-600 mb-2">Web適性検査</h1>
            <p className="text-gray-500 mb-8">模擬テスト対策アプリ</p>

            <div className="bg-blue-50 p-6 rounded-lg mb-8">
              <p className="font-bold text-gray-700 mb-2">問題数を選択してください</p>
              <div className="flex justify-center gap-2 flex-wrap">
                {[5, 10, 20, 30].map(num => (
                  <button
                    key={num}
                    onClick={() => setSelectedCount(num)}
                    className={`px-4 py-2 rounded-lg border-2 font-bold transition ${
                      selectedCount === num 
                      ? 'bg-blue-600 text-white border-blue-600' 
                      : 'bg-white text-gray-600 border-gray-200 hover:border-blue-400'
                    }`}
                  >
                    {num}問
                  </button>
                ))}
                <button
                    onClick={() => setSelectedCount(allQuestions.length)}
                    className={`px-4 py-2 rounded-lg border-2 font-bold transition ${
                      selectedCount === allQuestions.length 
                      ? 'bg-blue-600 text-white border-blue-600' 
                      : 'bg-white text-gray-600 border-gray-200 hover:border-blue-400'
                    }`}
                  >
                    全問 ({allQuestions.length})
                  </button>
              </div>
            </div>

            <button 
              onClick={startQuiz}
              className="w-full bg-blue-600 text-white text-xl font-bold py-4 rounded-full shadow-lg hover:bg-blue-700 hover:shadow-xl transition transform active:scale-[0.98] mb-10"
            >
              問題を始める
            </button>

            {/* 履歴表示エリア */}
            {history.length > 0 && (
              <div className="text-left border-t pt-6">
                <h3 className="font-bold text-gray-500 mb-4 text-sm">過去の成績（最新5件）</h3>
                <div className="space-y-3">
                  {history.slice(0, 5).map((item, idx) => (
                    <div key={idx} className="flex justify-between items-center text-sm bg-gray-50 p-3 rounded">
                      <span className="text-gray-500">{item.date}</span>
                      <span className="font-bold text-gray-700">{item.mode}コース</span>
                      <span className="font-bold text-blue-600">{item.score} / {item.total}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {allQuestions.length === 0 && (
              <p className="text-red-500 text-sm mt-4">※問題データが見つかりません</p>
            )}
          </div>
        )}

        {/* === クイズ画面 === */}
        {gameState === 'quiz' && currentQ && (
          <>
            <div className="flex justify-between items-center mb-6 border-b pb-4">
              <button onClick={backToMenu} className="text-xs text-gray-400 hover:text-gray-600">中断して戻る</button>
              <span className="text-sm font-bold text-blue-600">
                {currentIndex + 1} / {activeQuestions.length} 問目
              </span>
            </div>
            
            <h2 className="text-xl font-bold mb-8 leading-relaxed whitespace-pre-wrap">
              {currentQ.question}
            </h2>

            <div className="grid gap-4 mb-6">
              {[currentQ.option1, currentQ.option2, currentQ.option3, currentQ.option4].map((option, index) => {
                let btnClass = "border-gray-200 hover:bg-blue-50";
                
                if (isCorrect !== null) {
                   const correctNum = Number(currentQ.answer) - 1;
                   if (index === correctNum) {
                     btnClass = "bg-green-100 border-green-400 text-green-800 font-bold";
                   } else if (index !== correctNum && isCorrect === false) {
                     btnClass = "opacity-50";
                   }
                }

                return (
                  <button
                    key={index}
                    onClick={() => handleAnswer(index)}
                    disabled={isCorrect !== null}
                    className={`p-4 text-left border-2 rounded-lg transition-all ${btnClass}`}
                  >
                    <span className="inline-block w-6 h-6 bg-gray-200 text-gray-600 text-center leading-6 rounded-full text-xs mr-3">
                      {index + 1}
                    </span>
                    {option}
                  </button>
                );
              })}
            </div>

            {isCorrect !== null && (
              <div className="animate-fade-in bg-gray-50 p-6 rounded-lg border border-gray-200 mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-lg font-bold ${isCorrect ? "text-green-600" : "text-red-500"}`}>
                    {isCorrect ? "正解！" : "不正解..."}
                  </span>
                  <span className="text-sm text-gray-500">正解：{currentQ.answer}</span>
                </div>
                <p className="text-gray-700 font-bold mb-1">【解説】</p>
                <p className="text-gray-600 leading-relaxed whitespace-pre-wrap text-sm">
                  {currentQ.explanation}
                </p>
              </div>
            )}

            <div className="flex justify-between mt-6 pt-4 border-t border-gray-100">
                <button 
                    onClick={handlePrev}
                    className={`text-gray-500 hover:text-blue-600 font-bold px-4 py-2 ${currentIndex === 0 ? 'invisible' : ''}`}
                >
                    &larr; 前へ
                </button>

                {isCorrect !== null && (
                    <button 
                        onClick={handleNext}
                        className="bg-blue-600 text-white px-6 py-2 rounded-lg font-bold hover:bg-blue-700 transition shadow-md"
                    >
                        {currentIndex + 1 === activeQuestions.length ? "結果を見る" : "次へ \u2192"}
                    </button>
                )}
            </div>
          </>
        )}

        {/* === 結果画面 === */}
        {gameState === 'result' && (
          <div className="text-center py-6">
            <h2 className="text-3xl font-bold mb-2">結果発表</h2>
            <p className="text-gray-500 mb-8">お疲れ様でした！</p>
            
            <div className="text-6xl font-black text-blue-600 mb-4">
              {currentScore} <span className="text-2xl text-gray-400">/ {activeQuestions.length}</span>
            </div>
            <p className="mb-8 text-xl font-bold text-gray-700">
              正答率: {Math.round((currentScore / activeQuestions.length) * 100)}%
            </p>

            <div className="flex flex-col gap-3 max-w-xs mx-auto">
              <button 
                onClick={startQuiz} 
                className="bg-blue-600 text-white px-8 py-3 rounded-full font-bold hover:bg-blue-700 transition shadow-md"
              >
                同じ条件で再挑戦
              </button>
              <button 
                onClick={backToMenu} 
                className="bg-gray-100 text-gray-600 px-8 py-3 rounded-full font-bold hover:bg-gray-200 transition"
              >
                メニューに戻る
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}