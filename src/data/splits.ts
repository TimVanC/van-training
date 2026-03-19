import { buildSplitsFromCsv } from './parseSplitsCsv';
import csvText from './updated Split.csv?raw';

const splits = buildSplitsFromCsv(csvText);

export default splits;
