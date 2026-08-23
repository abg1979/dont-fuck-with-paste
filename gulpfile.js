const { spawn } = require('node:child_process');
const { rm } = require('node:fs/promises');
const gulp = require('gulp');
const zip = require('gulp-zip').default;

function run(command, args, callback) {
  const child = spawn(command, args, { stdio: 'inherit' });
  let completed = false;
  const finish = (error) => {
    if (!completed) {
      completed = true;
      callback(error);
    }
  };

  child.on('error', finish);
  child.on('close', (code) => {
    finish(code === 0 ? undefined : new Error(`${command} exited with code ${code}`));
  });
}

async function clean() {
  await Promise.all([
    rm('dist', { recursive: true, force: true }),
    rm('web-ext-artifacts', { recursive: true, force: true }),
  ]);
}

function lint(callback) {
  run('yarn', ['web-ext', 'lint'], callback);
}

function buildExtension(callback) {
  run('yarn', ['web-ext', 'build'], callback);
}

function archive() {
  return gulp.src([
    '**/*',
    '!dist{,/**}',
    '!node_modules{,/**}',
    '!.git{,/**}',
    '!.idea{,/**}',
    '!.yarn{,/**}',
    '!web-ext-artifacts{,/**}',
    '!.pnp.*',
  ], { base: '.', dot: true })
    .pipe(zip('src.zip'))
    .pipe(gulp.dest('dist'));
}

const build = gulp.series(lint, buildExtension);
const dist = gulp.series(clean, build, archive);

exports.clean = clean;
exports.lint = lint;
exports.build = build;
exports.archive = archive;
exports.dist = dist;
exports.default = dist;
