import type { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/home/home-page').then((m) => m.HomePage), title: 'DrawWithSmile — Free online drawing & guessing game' },
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
  {
    path: 'profile',
    loadComponent: () => import('./pages/profile/profile-page').then((m) => m.ProfilePage),
    title: 'DrawWithSmile — Avatar & title',
  },
  { path: '**', redirectTo: '' },
];
