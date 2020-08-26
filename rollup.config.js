import typescript from 'rollup-plugin-typescript2'

export default {
  input: 'src/index.ts',
  output: [
    { file: 'dist/berial.d.ts', format: 'esm', exports: 'named' },
    {
      file: 'dist/berial.esm.js',
      format: 'esm',
      sourcemap: true
    },
    {
      file: 'dist/berial.js',
      format: 'umd',
      sourcemap: true,
      name: 'berial'
    }
  ],
  plugins: [
    typescript({
      tsconfig: 'tsconfig.json',
      removeComments: true,
      useTsconfigDeclarationDir: true,
    }),
  ]
}
