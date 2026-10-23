import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-how-to-play-page',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="container page">
      <a routerLink="/" class="btn btn-ghost btn-sm">← Home</a>
      <h1>📖 How to play</h1>
      <ol class="steps">
        <li class="card"><span class="n">1</span><div><h2>Join a room</h2>
          <p><strong>Quick Play</strong> puts you in a public room with players from anywhere. The game starts automatically once two or more players are waiting.
          Or <strong>create a private room</strong> and share its 8-letter code with friends.</p></div></li>
        <li class="card"><span class="n">2</span><div><h2>Take turns drawing</h2>
          <p>Each turn one player draws. They pick one of three words (easy, medium or hard) and draw it — no letters or numbers!
          Use colours, brush sizes, the eraser, undo and redo.</p></div></li>
        <li class="card"><span class="n">3</span><div><h2>Guess in the chat</h2>
          <p>Everyone else types guesses. Capital letters and extra spaces don't matter. Letters are revealed as time runs out,
          and you'll get a private hint if a guess is very close.</p></div></li>
        <li class="card"><span class="n">4</span><div><h2>Score points</h2>
          <p>Faster guesses earn more points, and the first three correct guessers get a bonus. Hard words are worth more.
          The drawer earns points for every player who guesses their drawing.</p></div></li>
      </ol>
      <section class="card">
        <h2>Be kind 😊</h2>
        <p>Keep chat and drawings friendly. You can mute anyone just for yourself, report players, and vote to kick in public rooms.
        Private-room hosts can kick, ban or mute players.</p>
        <h2>Install the app</h2>
        <p>DrawWithSmile is a Progressive Web App. On Android choose <em>Add to Home screen</em> / <em>Install app</em> from the browser menu.
        On iPhone or iPad tap <em>Share → Add to Home Screen</em> in Safari.</p>
      </section>
      <a routerLink="/" class="btn btn-primary btn-lg">Let's play!</a>
    </div>
  `,
  styles: `
    .page { display: flex; flex-direction: column; gap: 14px; max-width: 760px; }
    .steps { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 14px; }
    .steps li { display: flex; gap: 14px; align-items: flex-start; }
    .steps h2, section h2 { font-size: 1.15rem; margin-bottom: 4px; }
    .steps p { margin: 0; }
    .n {
      flex: none; width: 40px; height: 40px; display: grid; place-items: center; border-radius: 50%;
      background: var(--sun); border: 2px solid var(--ink); font-weight: 800; font-size: 1.2rem;
    }
    .btn-lg { align-self: center; }
  `,
})
export class HowToPlayPage {}
