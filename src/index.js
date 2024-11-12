import express from "express";
import knex from "knex";
import { configDotenv } from "dotenv";
import { attachPaginate } from "knex-paginate";
import dateFormat from "dateformat";

configDotenv();

const app = express();
const db = knex({
    client: "pg",
    connection: process.env.PG_CONNECTION_STRING,
});

attachPaginate();

app.get("/health", (_, res) => {
    res.json({ status: "ok" });
});

app.get('/lessons', async (req, res) => {
    const { date, status, teacherIds, studentsCount, page = 1, lessonsPerPage = 5 } = req.query;

    // check data
    if (date !== undefined) {
        if (typeof date !== 'string')
            return res.status(400).json({ error: 'Invalid date format.' });

        // 2022-01-01 or 2022-01-01,2022-01-02
        const format = /^\d{4}-\d{2}-\d{2}(,\d{4}-\d{2}-\d{2})?$/;

        if (!format.test(date))
            return res.status(400).json({ error: 'Invalid date format. Expected: 01-01-2022 or 01-01-2022,01-01-2022' });

        const isRange = date.includes(',');
        if (isRange && date.split(',').length !== 2)
            return res.status(400).json({ error: 'Invalid date format. Expected: 01-01-2022 or 01-01-2022,01-01-2022' });

        if (isRange) {
            const [startDate, endDate] = date.split(',');
            // if startDate > endDate
            if (new Date(startDate) > new Date(endDate))
                return res.status(400).json({ error: 'Invalid date range. Start date must be before end date.' });
        }
    }

    if (page !== undefined) {
        if (/\d+/.test(page) === false)
            return res.status(400).json({ error: 'Invalid page number.' });

        if (page < 1)
            return res.status(400).json({ error: 'Invalid page number.' });
    }

    if (lessonsPerPage !== undefined) {
        if (/\d+/.test(lessonsPerPage) === false)
            return res.status(400).json({ error: 'Invalid lessons per page.' });

        if (lessonsPerPage < 1)
            return res.status(400).json({ error: 'Invalid lessons per page.' });
    }

    let query = db('lessons')
        .select('lessons.id', 'lessons.date', 'lessons.title', 'lessons.status')
        .leftJoin('lesson_teachers', 'lessons.id', 'lesson_teachers.lesson_id')
        .leftJoin('teachers', 'lesson_teachers.teacher_id', 'teachers.id')
        .leftJoin('lesson_students', 'lessons.id', 'lesson_students.lesson_id')
        .leftJoin('students', 'lesson_students.student_id', 'students.id')
        .groupBy('lessons.id');

    // Filters
    if (date) {
        const dateRange = date.split(',');
        if (dateRange.length === 2) {
            const [startDate, endDate] = dateRange;
            query.whereBetween('lessons.date', [startDate, endDate]);
        } else {
            query.where('lessons.date', date);
        }
    }
    if (status) {
        query.where('lessons.status', status);
    }
    if (teacherIds) {
        const ids = teacherIds.split(',').map(id => parseInt(id));
        if (ids.some(id => isNaN(id)))
            return res.status(400).json({ error: 'Invalid teacher IDs.' });

        query.whereIn('lesson_teachers.teacher_id', ids);
    }
    if (studentsCount) {
        query.havingRaw('COUNT(DISTINCT lesson_students.student_id) = ?', [studentsCount]);
    }

    try {
        const lessons = await query.paginate({
            perPage: lessonsPerPage,
            currentPage: page
        });

        const allTeachers = await db('lesson_teachers')
            .join('teachers', 'lesson_teachers.teacher_id', 'teachers.id');

        const allStudents = await db('lesson_students')
            .join('students', 'lesson_students.student_id', 'students.id');

        const formattedLessons = await Promise.all(lessons.data.map(async (lesson) => {
            const students = allStudents
                .filter(st => st.lesson_id === lesson.id)
                .map(student => ({
                    id: student.id,
                    name: student.name,
                    visit: student.visit
                }));

            const teachers = allTeachers
                .filter(te => te.lesson_id === lesson.id)
                .map(teacher => ({
                    id: teacher.id,
                    name: teacher.name
                }));

            const visitCount = students.filter(student => student.visit).length;

            return {
                id: lesson.id,
                date: dateFormat(lesson.date, "yyyy-mm-dd"),
                title: lesson.title,
                status: lesson.status,
                visitCount,
                students,
                teachers
            };
        }));

        res.json({
            currentPage: lessons.pagination.currentPage,
            totalCount: lessons.data.length,
            lessons: formattedLessons
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'An error occurred while fetching lessons.', details: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Listening on http://0.0.0.0:${PORT}`);
})