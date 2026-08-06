// storage.js
module.exports = {
    downloadUrl: function(game, hostUrl) {
        // Uygulama içi güvenli indirme endpoint'i
        return `${hostUrl}/profil/kutuphanem/indir/${game.slug}`;
    }
};
