import type { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/home/home-page').then((m) => m.HomePage), title: 'DrawWithSmile' },
  {
    path: 'room/:code',
    loadComponent: () => import('./pages/room/room-page').then((m) => m.RoomPage),
    title: 'DrawWithSmile — Room',
  },
  {
    path: 'leaderboard',
    loadComponent: () => import('./pages/leaderboard/leaderboard-page').then((m) => m.LeaderboardPage),
    title: 'DrawWithSmile — Leaderboard',
  },
  {
    path: 'how-to-play',
    loadComponent: () => import('./pages/how-to-play/how-to-play-page').then((m) => m.HowToPlayPage),
    title: 'DrawWithSmile — How to play',
  },
  { path: '**', redirectTo: '' },
];
