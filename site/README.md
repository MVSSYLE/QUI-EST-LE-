# Qui est le +

Jeu entre potes : chacun vote en secret, en même temps, sur son téléphone. Le résultat de chaque question s'affiche chez tout le monde, puis le classement de la soirée.
Pas de compte pour les joueurs : ils ouvrent un lien et cliquent sur leur photo.

## Mettre le site en ligne (gratuit, une seule fois)

Il te faut un compte GitHub et un compte Render, tous les deux gratuits. Les libellés des boutons peuvent légèrement changer.

1. **GitHub** : crée un compte sur github.com, puis *New repository*. Nom : `qui-est-le-plus`. Valide.
2. Sur la page du dépôt, clique *uploading an existing file* et glisse **tout le contenu de ce dossier** (le dossier `public` avec les photos, `server.js`, `package.json`, etc.). Valide avec *Commit changes*.
3. **Render** : va sur render.com, connecte-toi avec ton compte GitHub, puis *New +* → *Web Service* et choisis ton dépôt. Règle :
   - Language : `Node`
   - Build Command : `npm install`
   - Start Command : `node server.js`
   - Instance Type : `Free`
   - Environment Variables : ajoute `HOST_PIN` avec un code de ton choix (des chiffres). C'est le code organisateur.
4. Clique *Deploy*. Au bout de quelques minutes, Render te donne une adresse en `.onrender.com` : c'est le lien à envoyer à tes potes.

## Le soir de la partie

1. Ouvre le lien 2 minutes avant : le serveur gratuit s'endort après 15 minutes sans visite et met environ une minute à se réveiller.
2. Tout le monde ouvre le lien et clique sur sa photo.
3. Toi, en bas de l'écran : *Je suis l'organisateur*, tape ton code. Tu choisis le jeu et le nombre de questions, puis *Lancer la partie*.
4. À chaque question, tout le monde vote. Quand tu veux, tu appuies sur *Révéler le résultat*, puis *Question suivante*.
5. À la fin : le classement et les titres. *Nouvelle partie* remet tout le monde dans la salle d'attente.

## À savoir

- Le serveur retient qui a voté, jamais pour qui : même toi, l'organisateur, ne peux pas voir les votes individuels.
- Tout est gardé en mémoire : si le serveur redémarre en pleine partie, la partie est perdue.
- Un blaze pris par erreur : l'organisateur appuie sur *retirer* dans la salle d'attente.
- Pour tester chez toi : installe Node.js, puis `HOST_PIN=1234 node server.js` et ouvre http://localhost:3000.
