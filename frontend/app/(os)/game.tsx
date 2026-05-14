import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { C, MONO } from '@/src/theme';

const { width: W } = Dimensions.get('window');
const GRID = 15;
const CELL = Math.floor((W - 32) / GRID);
const BOARD = CELL * GRID;

type Pos = { x: number; y: number };
type Dir = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';

export default function GameScreen() {
  const router = useRouter();
  const [snake, setSnake] = useState<Pos[]>([{ x: 7, y: 7 }, { x: 6, y: 7 }, { x: 5, y: 7 }]);
  const [food, setFood] = useState<Pos>({ x: 10, y: 10 });
  const [dir, setDir] = useState<Dir>('RIGHT');
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [running, setRunning] = useState(false);
  const dirRef = useRef<Dir>('RIGHT');
  const intervalRef = useRef<any>(null);

  const randomFood = useCallback((snk: Pos[]): Pos => {
    let f: Pos;
    do {
      f = { x: Math.floor(Math.random() * GRID), y: Math.floor(Math.random() * GRID) };
    } while (snk.some(s => s.x === f.x && s.y === f.y));
    return f;
  }, []);

  const reset = () => {
    const newSnake = [{ x: 7, y: 7 }, { x: 6, y: 7 }, { x: 5, y: 7 }];
    setSnake(newSnake);
    setFood(randomFood(newSnake));
    setDir('RIGHT');
    dirRef.current = 'RIGHT';
    setScore(0);
    setGameOver(false);
    setRunning(true);
  };

  useEffect(() => {
    if (!running || gameOver) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(() => {
      setSnake(prev => {
        const head = { ...prev[0] };
        const d = dirRef.current;
        if (d === 'UP') head.y--;
        if (d === 'DOWN') head.y++;
        if (d === 'LEFT') head.x--;
        if (d === 'RIGHT') head.x++;

        // Wrap around
        if (head.x < 0) head.x = GRID - 1;
        if (head.x >= GRID) head.x = 0;
        if (head.y < 0) head.y = GRID - 1;
        if (head.y >= GRID) head.y = 0;

        // Self collision
        if (prev.some(s => s.x === head.x && s.y === head.y)) {
          setGameOver(true);
          setRunning(false);
          setHighScore(hs => Math.max(hs, score));
          return prev;
        }

        const newSnake = [head, ...prev];
        // Eat food
        if (head.x === food.x && head.y === food.y) {
          setScore(s => s + 10);
          setFood(randomFood(newSnake));
        } else {
          newSnake.pop();
        }
        return newSnake;
      });
    }, 150);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [running, gameOver, food, score]);

  const changeDir = (newDir: Dir) => {
    const opp: Record<Dir, Dir> = { UP: 'DOWN', DOWN: 'UP', LEFT: 'RIGHT', RIGHT: 'LEFT' };
    if (opp[newDir] !== dirRef.current) {
      dirRef.current = newDir;
      setDir(newDir);
    }
  };

  return (
    <SafeAreaView style={s.container} testID="game-screen">
      <View style={s.header}>
        <TouchableOpacity testID="game-back" onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={C.fgSecondary} />
        </TouchableOpacity>
        <Text style={s.title}>SNAKE</Text>
        <Text style={s.scoreText}>{score}</Text>
      </View>

      <View style={s.scoreboard}>
        <View style={s.scoreItem}>
          <Text style={s.scoreLabel}>SCORE</Text>
          <Text style={s.scoreVal}>{score}</Text>
        </View>
        <View style={s.scoreItem}>
          <Text style={s.scoreLabel}>HIGH SCORE</Text>
          <Text style={[s.scoreVal, { color: C.accent }]}>{highScore}</Text>
        </View>
      </View>

      {/* Game board */}
      <View style={[s.board, { width: BOARD, height: BOARD }]}>
        {/* Grid lines */}
        {Array.from({ length: GRID + 1 }).map((_, i) => (
          <View key={`h${i}`} style={[s.gridLine, { top: i * CELL, width: BOARD, height: 1 }]} />
        ))}
        {Array.from({ length: GRID + 1 }).map((_, i) => (
          <View key={`v${i}`} style={[s.gridLine, { left: i * CELL, height: BOARD, width: 1 }]} />
        ))}

        {/* Snake */}
        {snake.map((s, i) => (
          <View key={i} style={[
            st.snakeCell,
            { left: s.x * CELL + 1, top: s.y * CELL + 1, width: CELL - 2, height: CELL - 2 },
            i === 0 ? st.snakeHead : null
          ]} />
        ))}

        {/* Food */}
        <View style={[st.food, { left: food.x * CELL + 2, top: food.y * CELL + 2, width: CELL - 4, height: CELL - 4 }]} />

        {/* Game Over overlay */}
        {gameOver && (
          <View style={s.gameOverlay}>
            <Text style={s.gameOverText}>GAME OVER</Text>
            <Text style={s.gameOverScore}>SCORE: {score}</Text>
            <TouchableOpacity testID="game-restart" style={s.restartBtn} onPress={reset}>
              <Text style={s.restartText}>RESTART</Text>
            </TouchableOpacity>
          </View>
        )}
        {!running && !gameOver && (
          <View style={s.gameOverlay}>
            <Text style={s.gameOverText}>SNAKE</Text>
            <TouchableOpacity testID="game-start" style={s.restartBtn} onPress={reset}>
              <Text style={s.restartText}>START</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* D-pad controls */}
      <View style={s.controls}>
        <View style={s.dpadRow}>
          <View style={s.dpadEmpty} />
          <TouchableOpacity testID="dpad-up" style={s.dpadBtn} onPress={() => changeDir('UP')}>
            <Feather name="chevron-up" size={28} color={C.fg} />
          </TouchableOpacity>
          <View style={s.dpadEmpty} />
        </View>
        <View style={s.dpadRow}>
          <TouchableOpacity testID="dpad-left" style={s.dpadBtn} onPress={() => changeDir('LEFT')}>
            <Feather name="chevron-left" size={28} color={C.fg} />
          </TouchableOpacity>
          <View style={[s.dpadBtn, s.dpadCenter]}>
            <Feather name="circle" size={12} color={C.fgSecondary} />
          </View>
          <TouchableOpacity testID="dpad-right" style={s.dpadBtn} onPress={() => changeDir('RIGHT')}>
            <Feather name="chevron-right" size={28} color={C.fg} />
          </TouchableOpacity>
        </View>
        <View style={s.dpadRow}>
          <View style={s.dpadEmpty} />
          <TouchableOpacity testID="dpad-down" style={s.dpadBtn} onPress={() => changeDir('DOWN')}>
            <Feather name="chevron-down" size={28} color={C.fg} />
          </TouchableOpacity>
          <View style={s.dpadEmpty} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  snakeCell: { position: 'absolute', backgroundColor: C.success, borderRadius: 2 },
  snakeHead: { backgroundColor: '#00FF41' },
  food: { position: 'absolute', backgroundColor: C.accent, borderRadius: 2 },
});

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  title: { fontFamily: MONO, fontSize: 14, color: C.fg, letterSpacing: 4 },
  scoreText: { fontFamily: MONO, fontSize: 14, color: C.accent },
  scoreboard: { flexDirection: 'row', justifyContent: 'center', paddingVertical: 8 },
  scoreItem: { alignItems: 'center', marginHorizontal: 24 },
  scoreLabel: { fontFamily: MONO, fontSize: 9, color: C.fgSecondary, letterSpacing: 2 },
  scoreVal: { fontFamily: MONO, fontSize: 24, color: C.fg, fontWeight: '600' },
  board: { alignSelf: 'center', backgroundColor: 'rgba(255,255,255,0.02)', borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  gridLine: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.03)' },
  gameOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(5,5,5,0.85)', justifyContent: 'center', alignItems: 'center' },
  gameOverText: { fontFamily: MONO, fontSize: 28, color: C.fg, letterSpacing: 6, fontWeight: '800' },
  gameOverScore: { fontFamily: MONO, fontSize: 16, color: C.fgSecondary, marginTop: 8 },
  restartBtn: { marginTop: 16, backgroundColor: C.accent, paddingHorizontal: 32, paddingVertical: 12, borderRadius: 0 },
  restartText: { fontFamily: MONO, fontSize: 14, color: C.fg, letterSpacing: 3 },
  controls: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  dpadRow: { flexDirection: 'row' },
  dpadBtn: { width: 60, height: 54, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', margin: 2, borderRadius: 0 },
  dpadCenter: { backgroundColor: 'rgba(255,255,255,0.02)' },
  dpadEmpty: { width: 60, height: 54, margin: 2 },
});
