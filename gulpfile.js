var gulp = require('gulp');
var ts = require('gulp-typescript');
var tsProject = ts.createProject('tsconfig.json');
var nodemon = require('gulp-nodemon');
Cache = require('gulp-file-cache');

var cache = new Cache();

var compile = function () {
    return tsProject.src()
        .pipe(cache.filter())
        .pipe(tsProject())
        .js
        .pipe(cache.cache())
        .pipe(gulp.dest('dist'));
};

gulp.task('compile', compile);
gulp.task('watch', function(done) {
    var stream = nodemon({
        script: 'dist/', // run ES5 code
        watch: 'src/index.ts', // watch ES2015 code
        tasks: ['compile'], // compile synchronously onChange
        done: done
    });

    stream.on('restart', function () {
        console.log('restarted!');
    }).on('crash', function() {
        console.error('Application has crashed!\n');
        stream.emit('restart', 10);  // restart the server in 10 seconds
    });

    return stream;
});
