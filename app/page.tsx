'use client';

import { useState, useEffect } from 'react';
import Papa from 'papaparse';

// --- ★設定エリア ---
const APP_TITLE = "期末試験対策";
const APP_SUBTITLE = "消費者行動論Ⅱ";
// ------------------

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

type MistakeRecord = {
  question: string;
  correctAnswer: string;
};

type HistoryItem = {
  date: string;
  score: number;
  total: number;
  mode: string;
  mistakes: MistakeRecord[];
};

// 選択肢表示用の型（シャッフル用）
type DisplayOption = {
  text: string;
  originalIndex: number; // 元のCSVでの番号（1~4）
};

const shuffleArray = <T,>(array: T[]): T[] => {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
};

export default function Home() {
  const [gameState, setGameState] = useState<'loading' | 'menu' | 'quiz' | 'result' | 'history'>('loading');
  const [allQuestions, setAllQuestions] = useState<Question[]>([]);
  const [activeQuestions, setActiveQuestions] = useState<Question[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  
  // クイズ中の状態
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [userSelectedIndex, setUserSelectedIndex] = useState<number | null>(null); // 表示上のインデックス
  const [solvedQuestions, setSolvedQuestions] = useState<Set<number>>(new Set());
  
  // ★シャッフルされた選択肢を保持するState
  const [currentOptions, setCurrentOptions] = useState<DisplayOption[]>([]);

  // 設定
  const [selectedCount, setSelectedCount] = useState<number>(10);
  const [expandedHistoryIndex, setExpandedHistoryIndex] = useState<number | null>(null);

  const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQyTaqBFKydSZeEcF8bJeYg95H_yfr1LcfeypU2ojVoTHxl2J9mJcacVRuu3u5MEmieYum_Pedg_Ptu/pub?gid=2142520007&single=true&output=csv';

  useEffect(() => {
    Papa.parse(SHEET_URL, {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const data = results.data as Question[];
        if (data.length > 0) {
          setAllQuestions(data);
          // 初期値として全問数を最大値にセットしたくない場合は10のまま、など調整可能
          if (data.length < 10) setSelectedCount(data.length);
        }
        setGameState('menu');
      },
      error: (err) => {
        console.error("CSV error:", err);
        setGameState('menu');
      }
    });

    const savedHistory = localStorage.getItem('quiz_history');
    if (savedHistory) {
      setHistory(JSON.parse(savedHistory));
    }
  }, []);

  // 選択肢を生成してシャッフルする関数
  const generateShuffledOptions = (q: Question) => {
    const opts: DisplayOption[] = [
      { text: q.option1, originalIndex: 1 },
      { text: q.option2, originalIndex: 2 },
      { text: q.option3, originalIndex: 3 },
      { text: q.option4, originalIndex: 4 },
    ];
    return shuffleArray(opts);
  };

  const startQuiz = () => {
    if (selectedCount <= 0) {
        alert("出題数は1問以上にしてください");
        return;
    }
    let questionsToPlay = shuffleArray(allQuestions);
    if (selectedCount < questionsToPlay.length) {
      questionsToPlay = questionsToPlay.slice(0, selectedCount);
    }
    setActiveQuestions(questionsToPlay);
    setCurrentIndex(0);
    setSolvedQuestions(new Set());
    setIsCorrect(null);
    setUserSelectedIndex(null);
    
    // 最初の問題の選択肢をセット
    setCurrentOptions(generateShuffledOptions(questionsToPlay[0]));
    
    setGameState('quiz');
  };

  // 回答処理
  const handleAnswer = (displayIndex: number) => {
    if (isCorrect !== null) return;
    
    setUserSelectedIndex(displayIndex);

    // シャッフルされた選択肢の中から、選んだものの originalIndex を取得
    const selectedOriginalIndex = currentOptions[displayIndex].originalIndex;
    const correctOriginalIndex = Number(activeQuestions[currentIndex].answer);
    
    const result = selectedOriginalIndex === correctOriginalIndex;
    setIsCorrect(result);

    if (result) {
      setSolvedQuestions(prev => {
        const newSet = new Set(prev);
        newSet.add(currentIndex);
        return newSet;
      });
    }
  };

  const handleNext = () => {
    const nextIndex = currentIndex + 1;
    if (nextIndex < activeQuestions.length) {
      setIsCorrect(null);
      setUserSelectedIndex(null);
      setCurrentIndex(nextIndex);
      // 次の問題の選択肢をシャッフルしてセット
      setCurrentOptions(generateShuffledOptions(activeQuestions[nextIndex]));
    } else {
      finishQuiz(false); // 通常終了
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      const prevIndex = currentIndex - 1;
      setIsCorrect(null);
      setUserSelectedIndex(null);
      setCurrentIndex(prevIndex);
      // 前の問題の選択肢をシャッフルしてセット（※再シャッフルされます）
      setCurrentOptions(generateShuffledOptions(activeQuestions[prevIndex]));
    }
  };

  // 終了処理（isEarlyExit=trueなら途中終了）
  const finishQuiz = (isEarlyExit: boolean) => {
    // 途中終了の場合、解いた問題数（現在のインデックス+1、ただし未回答なら現在のインデックスまで）
    // 今回は「現在表示中の問題を解いたかどうか」に関わらず、ここまで見た問題数を分母にする
    // あるいは「正解数 / ここまで解こうとした数」にする
    
    let actualTotal = activeQuestions.length;
    let modeText = activeQuestions.length === allQuestions.length ? "全問" : `${activeQuestions.length}問`;

    if (isEarlyExit) {
        // 途中終了なら、分母は「現在表示している問題まで」とする
        // もし今の問題を回答済みなら currentIndex + 1、未回答なら currentIndex
        const finishedCount = isCorrect !== null ? currentIndex + 1 : currentIndex;
        if (finishedCount === 0) {
            // 1問も解かずにやめる場合
            backToMenu();
            return;
        }
        actualTotal = finishedCount;
        modeText += "(途中)";
    }

    const score = solvedQuestions.size;
    
    const mistakes: MistakeRecord[] = [];
    // 途中終了の場合は、actualTotalまでチェックする
    for (let i = 0; i < actualTotal; i++) {
        if (!solvedQuestions.has(i)) {
            const q = activeQuestions[i];
            const correctIndex = Number(q.answer) - 1;
            const options = [q.option1, q.option2, q.option3, q.option4];
            mistakes.push({
                question: q.question,
                correctAnswer: options[correctIndex] || `選択肢${q.answer}`
            });
        }
    }

    const newHistoryItem: HistoryItem = {
      date: new Date().toLocaleString('ja-JP'),
      score: score,
      total: actualTotal,
      mode: modeText,
      mistakes: mistakes
    };

    const newHistory = [newHistoryItem, ...history].slice(0, 50); 
    setHistory(newHistory);
    localStorage.setItem('quiz_history', JSON.stringify(newHistory));
    setGameState('result');
  };

  const backToMenu = () => {
    setGameState('menu');
  };

  const clearHistory = () => {
    if (confirm('履歴をすべて削除しますか？')) {
      setHistory([]);
      localStorage.removeItem('quiz_history');
    }
  };

  const handleCountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    if (val >= 0 && val <= allQuestions.length) setSelectedCount(val);
  };

  const toggleHistoryDetail = (index: number) => {
    setExpandedHistoryIndex(expandedHistoryIndex === index ? null : index);
  };

  const currentScore = solvedQuestions.size;
  const currentQ = activeQuestions[currentIndex];

  if (gameState === 'loading') return <div className="flex h-screen items-center justify-center font-bold text-gray-600">読み込み中...</div>;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gray-50 p-4 text-gray-800 font-sans">
      <div className="w-full max-w-2xl bg-white p-6 md:p-10 rounded-xl shadow-xl border border-gray-100 min-h-[500px] flex flex-col justify-center">
        
        {/* === メニュー画面 === */}
        {gameState === 'menu' && (
          <div className="text-center w-full">
            <h1 className="text-3xl md:text-4xl font-black text-blue-600 mb-2">{APP_TITLE}</h1>
            <p className="text-gray-500 mb-8">{APP_SUBTITLE}</p>

            <div className="bg-blue-50 p-6 rounded-lg mb-6">
              <p className="font-bold text-gray-700 mb-4">出題数: {selectedCount}問</p>
              
              {/* ★スライダー実装 */}
              <div className="flex items-center gap-4 mb-4">
                <span className="text-sm text-gray-400 font-bold">1</span>
                <input 
                  type="range" 
                  min="1" 
                  max={allQuestions.length} 
                  value={selectedCount} 
                  onChange={handleCountChange}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
                <span className="text-sm text-gray-400 font-bold">{allQuestions.length}</span>
              </div>

              {/* 手入力エリア */}
              <div className="flex items-center justify-center gap-2">
                <span className="text-sm font-bold text-gray-500">直接入力:</span>
                <input 
                    type="number" 
                    min="1" 
                    max={allQuestions.length}
                    value={selectedCount}
                    onChange={handleCountChange}
                    className="w-20 p-2 text-center text-lg font-bold border-2 border-gray-300 rounded-lg focus:border-blue-500 outline-none"
                />
                <span className="font-bold text-gray-600">問</span>
              </div>
            </div>

            <div className="space-y-3">
              <button onClick={startQuiz} className="w-full bg-blue-600 text-white text-xl font-bold py-4 rounded-full shadow-lg hover:bg-blue-700 transition active:scale-[0.98]">
                問題を始める
              </button>
              <button onClick={() => setGameState('history')} className="w-full bg-white text-blue-600 border-2 border-blue-600 text-lg font-bold py-3 rounded-full hover:bg-blue-50 transition">
                成績履歴を見る
              </button>
            </div>
          </div>
        )}

        {/* === 履歴画面 === */}
        {gameState === 'history' && (
          <div className="w-full h-full flex flex-col">
            <div className="flex justify-between items-center mb-6 border-b pb-4">
               <h2 className="text-2xl font-bold text-gray-700">成績履歴</h2>
               <button onClick={backToMenu} className="text-sm bg-gray-200 px-3 py-1 rounded hover:bg-gray-300">戻る</button>
            </div>

            <div className="flex-1 overflow-y-auto max-h-[500px] pr-2 space-y-3">
              {history.length === 0 ? (
                <div className="text-center py-10 text-gray-400">
                  <p>履歴はありません</p>
                </div>
              ) : (
                history.map((item, idx) => (
                  <div key={idx} className="bg-gray-50 rounded border border-gray-200 overflow-hidden">
                    <div className="flex justify-between items-center p-4">
                        <div>
                            <div className="text-xs text-gray-500 mb-1">{item.date}</div>
                            <div className="font-bold text-gray-700">{item.mode}</div>
                        </div>
                        <div className="text-right">
                             <div className="text-xl font-black text-blue-600">
                                {item.score}<span className="text-sm text-gray-400 font-normal">/{item.total}</span>
                            </div>
                        </div>
                    </div>
                    {item.mistakes && item.mistakes.length > 0 && (
                        <div className="px-4 pb-4">
                            <button 
                                onClick={() => toggleHistoryDetail(idx)}
                                className="text-xs text-red-500 font-bold hover:underline flex items-center gap-1"
                            >
                                {expandedHistoryIndex === idx ? "▲ 閉じる" : "▼ 間違えた問題を確認"}
                            </button>
                            {expandedHistoryIndex === idx && (
                                <div className="mt-3 bg-white p-3 rounded border border-red-100 text-sm space-y-4 animate-fade-in">
                                    {item.mistakes.map((mistake, mIdx) => (
                                        <div key={mIdx} className="border-b border-gray-100 last:border-0 pb-2 last:pb-0">
                                            <p className="font-bold text-gray-700 mb-1">Q. {mistake.question}</p>
                                            <p className="text-green-600 font-bold">A. {mistake.correctAnswer}</p>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                  </div>
                ))
              )}
            </div>
            {history.length > 0 && (
              <div className="mt-6 text-center">
                <button onClick={clearHistory} className="text-xs text-red-400 underline hover:text-red-600">履歴削除</button>
              </div>
            )}
          </div>
        )}

        {/* === クイズ画面 === */}
        {gameState === 'quiz' && currentQ && (
          <>
            <div className="flex justify-between items-center mb-6 border-b pb-4">
              <button onClick={backToMenu} className="text-xs text-gray-400 hover:text-gray-600">
                &larr; メニューへ戻る（保存しない）
              </button>
              <div className="flex items-center gap-4">
                 <span className="text-sm font-bold text-blue-600">
                    {currentIndex + 1} / {activeQuestions.length} 問
                 </span>
                 {/* ★途中終了ボタン */}
                 <button 
                    onClick={() => finishQuiz(true)}
                    className="text-xs bg-red-100 text-red-600 px-3 py-1 rounded-full font-bold hover:bg-red-200 transition"
                 >
                    中断して記録
                 </button>
              </div>
            </div>
            
            <h2 className="text-xl font-bold mb-8 leading-relaxed whitespace-pre-wrap">
              {currentQ.question}
            </h2>

            <div className="grid gap-4 mb-6">
              {/* シャッフルされた選択肢（currentOptions）を表示 */}
              {currentOptions.map((opt, displayIndex) => {
                let btnClass = "border-gray-200 hover:bg-blue-50";
                let badge = <span className="inline-block w-6 h-6 bg-gray-200 text-gray-600 text-center leading-6 rounded-full text-xs mr-3">{displayIndex + 1}</span>;

                if (isCorrect !== null) {
                   const correctOriginalIndex = Number(currentQ.answer); // 1~4
                   const isThisCorrect = opt.originalIndex === correctOriginalIndex;
                   const isThisSelected = displayIndex === userSelectedIndex;

                   if (isThisCorrect) {
                     btnClass = "bg-green-100 border-green-400 text-green-800 font-bold";
                     badge = <span className="inline-block w-6 h-6 bg-green-500 text-white text-center leading-6 rounded-full text-xs mr-3">✔</span>;
                   } else if (isThisSelected) {
                     btnClass = "bg-red-100 border-red-400 text-red-800 font-bold";
                     badge = <span className="inline-block w-auto px-2 h-6 bg-red-500 text-white text-center leading-6 rounded-full text-xs mr-3">あなたの回答</span>;
                   } else {
                     btnClass = "opacity-40";
                   }
                }

                return (
                  <button key={displayIndex} onClick={() => handleAnswer(displayIndex)} disabled={isCorrect !== null} className={`p-4 text-left border-2 rounded-lg transition-all ${btnClass}`}>
                    {badge}
                    {opt.text}
                  </button>
                );
              })}
            </div>

            {isCorrect !== null && (
              <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 mb-4 animate-fade-in">
                <div className="flex items-center gap-2 mb-2">
                    {isCorrect ? (
                        <span className="text-green-600 font-bold text-lg">正解！</span>
                    ) : (
                        <span className="text-red-500 font-bold text-lg">不正解...</span>
                    )}
                </div>
                <div className="font-bold mb-1 text-gray-700">【解説】</div>
                <div className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">{currentQ.explanation}</div>
              </div>
            )}

            <div className="flex justify-between mt-auto pt-4 border-t border-gray-100">
                <button onClick={handlePrev} className={`text-gray-500 font-bold px-4 py-2 ${currentIndex === 0 ? 'invisible' : ''}`}>&larr; 前へ</button>
                {isCorrect !== null && (
                    <button onClick={handleNext} className="bg-blue-600 text-white px-6 py-2 rounded-lg font-bold hover:bg-blue-700 transition">
                        {currentIndex + 1 === activeQuestions.length ? "結果へ" : "次へ \u2192"}
                    </button>
                )}
            </div>
          </>
        )}

        {/* === 結果画面 === */}
        {gameState === 'result' && (
          <div className="text-center py-6">
            <h2 className="text-3xl font-bold mb-2">結果発表</h2>
            <div className="text-6xl font-black text-blue-600 mb-4">
              {/* スコア表示の分母を、実際に回答した問題数(historyの最新から取得)に合わせる */}
              {currentScore} <span className="text-2xl text-gray-400">/ {history[0]?.total || activeQuestions.length}</span>
            </div>
            <p className="mb-8 text-xl font-bold text-gray-700">
              正答率: {Math.round((currentScore / (history[0]?.total || activeQuestions.length)) * 100)}%
            </p>
            <div className="flex flex-col gap-3 max-w-xs mx-auto">
              <button onClick={startQuiz} className="bg-blue-600 text-white px-8 py-3 rounded-full font-bold hover:bg-blue-700 transition">同じ設定で再挑戦</button>
              <button onClick={() => setGameState('history')} className="bg-white border-2 border-gray-300 text-gray-600 px-8 py-3 rounded-full font-bold hover:bg-gray-50 transition">履歴を見る</button>
              <button onClick={backToMenu} className="text-gray-400 underline mt-2 text-sm hover:text-gray-600">トップに戻る</button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}