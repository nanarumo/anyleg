# Anyleg

Fake-money sportsbook + casino where any outcome can be a parlay leg.

```
npm install
npm run dev     # http://localhost:5173
npm test        # betting/game math checks
```

- **Sportsbook**: live sportsbook lines from ESPN's public scoreboard API, polled every 30s. Bets settle automatically when games go final.
- **Blackjack / Roulette**: playable games; "parlay leg" buttons add the next hand/spin to the bet slip alongside sports picks.
- Wallet starts at $1,000 and lives in localStorage (click the balance to reset).
